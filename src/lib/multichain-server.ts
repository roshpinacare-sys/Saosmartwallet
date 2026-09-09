/**
 * MULTI-CHAIN SOVEREIGN EYES — live read-only eyes on the vault's Ethereum
 * and Solana fleets.
 *
 * The gap this closes: the vault holds 12 ethereum wallets + 12 solana
 * wallets (plus tron — no adapter yet, never hand-rolled), the adapters
 * existed in packages/chains with verified-live public endpoints and
 * failover — but the agents had ZERO modules for them. The army was blind
 * on two whole chains where its own treasury lives.
 *
 * Iron rules carried over:
 *  · READS ONLY — the adapters here are the registry singletons, which are
 *    fail-closed on broadcast by default (M0 gate). No signing path exists
 *    below this file.
 *  · Addresses come from VaultEntry.pub (public by definition) — private
 *    material never leaves the vault, exactly like vault.map.
 *  · Every wallet probe is bounded and allSettled — one dead node or one
 *    dead wallet never kills the fleet report; failures are honest rows.
 */
import { db } from "@/lib/db";
import { getEthereumAdapter, getSolanaAdapter } from "../../packages/chains/index";
import { formatLamports } from "../../packages/chains/solana";
import { formatEther } from "ethers";

const MAX_WALLETS = 16; // fleet cap — bounded pass, never stampede the RPC

async function walletRows(chain: string): Promise<Array<{ account: string; pub: string }>> {
  return db.vaultEntry.findMany({
    where: { chain, role: "wallet", status: { not: "rotated-out" } },
    select: { account: true, pub: true },
    orderBy: { account: "asc" },
    take: MAX_WALLETS,
  });
}

export interface ChainWalletEye {
  account: string;
  address: string;
  ok: boolean;
  balance?: string; // human format (ETH / SOL)
  rawBalance?: string; // integer-exact (wei / lamports) — used for exact sums
  nonce?: number;
  isContract?: boolean;
  tokens?: number; // SPL token mints held (solana)
  error?: string;
}

export interface EthereumEyes {
  chain: Awaited<ReturnType<EthereumAdapterLike["getChainInfo"]>>;
  wallets: ChainWalletEye[];
  totalOk: number;
  totalBalanceEth: string;
}
interface EthereumAdapterLike {
  getChainInfo: () => Promise<{ network: string; chainId: number; blockHeight: number; nativeToken: { symbol: string; decimals: number }; gasPrice: string | null; via: string }>;
  getAccountInfo: (address: string) => Promise<{ address: string; balance: string; nonce: number; isContract: boolean }>;
}

/** The whole ethereum fleet: chain info + every vault wallet, live. */
export async function ethereumEyes(): Promise<EthereumEyes> {
  const adapter = getEthereumAdapter();
  const [info, rows] = await Promise.all([adapter.getChainInfo(), walletRows("ethereum")]);
  const wallets = await Promise.all(
    rows.map(async (r): Promise<ChainWalletEye> => {
      try {
        const a = await adapter.getAccountInfo(r.pub);
        return { account: r.account, address: r.pub, ok: true, balance: formatEther(BigInt(a.balance)), rawBalance: a.balance, nonce: a.nonce, isContract: a.isContract };
      } catch (e) {
        return { account: r.account, address: r.pub, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
      }
    }),
  );
  const totalWei = wallets.reduce((acc, w) => (w.ok && w.rawBalance ? acc + BigInt(w.rawBalance) : acc), 0n);
  return {
    chain: info,
    wallets,
    totalOk: wallets.filter((w) => w.ok).length,
    totalBalanceEth: formatEther(totalWei),
  };
}

export interface SolanaEyes {
  chain: Awaited<ReturnType<SolanaAdapterLike["getChainInfo"]>>;
  wallets: ChainWalletEye[];
  totalOk: number;
  totalBalanceSol: string;
}
interface SolanaAdapterLike {
  getChainInfo: () => Promise<{ network: string; blockHeight: number; nativeToken: { symbol: string; decimals: number }; via: string }>;
  getAccountInfo: (address: string) => Promise<{ address: string; balance: string; ownerProgram: string | null }>;
  getTokenBalances: (owner: string) => Promise<Array<{ mint: string; formatted: string | null }>>;
}

/** The whole solana fleet: chain info + every vault wallet + SPL token count. */
export async function solanaEyes(): Promise<SolanaEyes> {
  const adapter = getSolanaAdapter();
  const [info, rows] = await Promise.all([adapter.getChainInfo(), walletRows("solana")]);
  const wallets = await Promise.all(
    rows.map(async (r): Promise<ChainWalletEye> => {
      try {
        const a = await adapter.getAccountInfo(r.pub);
        let tokens: number | undefined;
        try {
          const t = await adapter.getTokenBalances(r.pub);
          tokens = t.filter((x) => x.formatted && x.formatted !== "0").length;
        } catch {
          tokens = undefined; // SPL scan is best-effort — native balance is the fact
        }
        return { account: r.account, address: r.pub, ok: true, balance: formatLamports(a.balance), rawBalance: a.balance, tokens };
      } catch (e) {
        return { account: r.account, address: r.pub, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
      }
    }),
  );
  const totalLamports = wallets.reduce((acc, w) => (w.ok && w.rawBalance ? acc + BigInt(w.rawBalance) : acc), 0n);
  return {
    chain: info,
    wallets,
    totalOk: wallets.filter((w) => w.ok).length,
    totalBalanceSol: formatLamports(totalLamports.toString()),
  };
}
