'use client'

/**
 * Shared "one-time setup" banner that drives the user through:
 *   1. Switching MetaMask to Arc Testnet (chainId 5042002)
 *   2. Approving the PredictionMarketManager to spend their USDC
 *   3. Approving the Exchange to spend their USDC
 *
 * ERC-20 approvals are per (token, spender) — they are NOT per market — so once
 * both approvals are set, every market on this deployment is good to go.
 *
 * Mount this anywhere that takes user actions (markets list, trade page, etc).
 * It self-hides when:
 *   - wallet is disconnected,
 *   - already on Arc Testnet with both allowances set, or
 *   - contracts haven't been loaded for the active chain.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { maxUint256 } from 'viem'
import {
  useAccount,
  useConfig,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { useWalletChainId } from '@/hooks/use-wallet-chain-id'
import {
  arcAddEthereumChainParameter,
  arcChainMismatchMessage,
  ensureArcWalletChain,
} from '@/lib/ensure-arc-chain'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { mustGetContract } from '@/lib/contracts'
import { arcTestnet } from '@/lib/chains/arcTestnet'
import { arcUsdcContract, usdcErc20Abi } from '@/lib/usdc'
import { cn } from '@/lib/utils'

export function WalletApprovals({ className }: { className?: string }) {
  const { address, isConnected } = useAccount()
  const config = useConfig()
  const chainId = useWalletChainId()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const { writeContractAsync, data: pendingTx } = useWriteContract()
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: pendingTx })
  const [submitting, setSubmitting] = useState<'manager' | 'exchange' | 'outcome' | null>(null)

  const onArc = chainId === arcTestnet.id

  // Resolve manager/exchange/outcome token — only safe to do once we're on Arc.
  let manager: { address: `0x${string}`; abi: readonly unknown[] } | null = null
  let exchange: { address: `0x${string}`; abi: readonly unknown[] } | null = null
  let outcomeToken: { address: `0x${string}`; abi: readonly unknown[] } | null = null
  if (onArc) {
    try {
      manager = mustGetContract(chainId, 'PredictionMarketManager')
      exchange = mustGetContract(chainId, 'Exchange')
      outcomeToken = mustGetContract(chainId, 'OutcomeToken1155')
    } catch {
      manager = null
      exchange = null
      outcomeToken = null
    }
  }

  const { data: allowanceMgr } = useReadContract({
    address: arcUsdcContract.address,
    abi: usdcErc20Abi,
    functionName: 'allowance',
    args: address && manager ? [address, manager.address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(isConnected && onArc && manager && address) },
  })
  const { data: allowanceEx } = useReadContract({
    address: arcUsdcContract.address,
    abi: usdcErc20Abi,
    functionName: 'allowance',
    args: address && exchange ? [address, exchange.address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(isConnected && onArc && exchange && address) },
  })

  const { data: outcomeApproved } = useReadContract({
    address: outcomeToken?.address,
    abi: outcomeToken?.abi,
    functionName: 'isApprovedForAll',
    args: address && exchange ? [address, exchange.address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(isConnected && onArc && outcomeToken && exchange && address) },
  })

  const HALF_MAX = maxUint256 / 2n
  const needsManager = !manager || typeof allowanceMgr !== 'bigint' || allowanceMgr < HALF_MAX
  const needsExchange = !exchange || typeof allowanceEx !== 'bigint' || allowanceEx < HALF_MAX
  const needsOutcome = !outcomeToken || outcomeApproved !== true
  const allSet =
    onArc && manager && exchange && outcomeToken && !needsManager && !needsExchange && !needsOutcome

  if (!isConnected) return null
  if (allSet) return null

  // ── Wrong network state ───────────────────────────────────────────────────
  if (!onArc) {
    const switchToArc = async () => {
      const ok = await ensureArcWalletChain(config)
      if (ok) {
        toast.success('Switched to Arc Testnet')
        return
      }
      try {
        await switchChainAsync({
          chainId: arcTestnet.id,
          addEthereumChainParameter: arcAddEthereumChainParameter,
        })
        toast.success('Switched to Arc Testnet')
      } catch (e: any) {
        toast.error('Could not switch to Arc Testnet', {
          description:
            e?.shortMessage ??
            arcChainMismatchMessage(chainId) +
              ' In MetaMask: Networks → Add network → Arc Testnet (5042002).',
        })
      }
    }
    return (
      <section
        className={cn(
          'rounded-xl border border-destructive/40 bg-destructive/5 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3',
          className,
        )}
      >
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-destructive">
            Wrong network — switch to Arc Testnet
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connected to chain {chainId}. The protocol lives on Circle Arc Testnet
            (chain 5042002, USDC at 0x3600…0000).
          </p>
        </div>
        <Button size="sm" onClick={() => void switchToArc()} disabled={switching}>
          {switching ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
          Switch to Arc Testnet
        </Button>
      </section>
    )
  }

  if (!manager || !exchange || !outcomeToken) {
    return (
      <section
        className={cn(
          'rounded-xl border border-destructive/40 bg-destructive/5 p-4',
          className,
        )}
      >
        <p className="text-sm font-semibold text-destructive">Contracts not found</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          No ABI bundle for chain {chainId}. Re-run{' '}
          <code className="text-xs bg-background/40 px-1 rounded">
            yarn agora:sync-abi
          </code>
          .
        </p>
      </section>
    )
  }

  const approveUsdc = async (
    spender: `0x${string}`,
    role: 'manager' | 'exchange',
    label: string,
  ) => {
    setSubmitting(role)
    try {
      const onArcNow = await ensureArcWalletChain(config)
      if (!onArcNow) {
        toast.error('Switch to Arc Testnet first', {
          description: arcChainMismatchMessage(chainId),
        })
        return
      }
      await writeContractAsync({
        address: arcUsdcContract.address,
        abi: usdcErc20Abi,
        chainId: arcTestnet.id,
        functionName: 'approve',
        args: [spender, maxUint256],
      })
      toast.success(`${label} approval submitted`)
    } catch (e: any) {
      toast.error(`${label} approval failed`, {
        description: e?.shortMessage ?? String(e?.message ?? e),
      })
    } finally {
      setSubmitting(null)
    }
  }

  const approveOutcomeForExchange = async () => {
    if (!exchange || !outcomeToken) return
    setSubmitting('outcome')
    try {
      const onArcNow = await ensureArcWalletChain(config)
      if (!onArcNow) {
        toast.error('Switch to Arc Testnet first', {
          description: arcChainMismatchMessage(chainId),
        })
        return
      }
      await writeContractAsync({
        address: outcomeToken.address,
        abi: outcomeToken.abi,
        chainId: arcTestnet.id,
        functionName: 'setApprovalForAll',
        args: [exchange.address, true],
      })
      toast.success('Outcome token approval submitted')
    } catch (e: any) {
      toast.error('Outcome token approval failed', {
        description: e?.shortMessage ?? String(e?.message ?? e),
      })
    } finally {
      setSubmitting(null)
    }
  }

  const busy = (role: 'manager' | 'exchange' | 'outcome') =>
    submitting === role || (submitting === null && confirming)

  return (
    <section
      className={cn(
        'rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg">🔑</span>
        <div>
          <p className="text-sm font-semibold text-primary">
            One-time wallet setup
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Approve USDC and outcome tokens so you can split shares, post offers,
            and fill orders. You only do this once per wallet on this deployment.
          </p>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <ApprovalRow
          step="①"
          title="Approve Market Manager"
          desc="Lets the manager pull USDC when you split into YES/NO shares."
          done={!needsManager}
          busy={busy('manager')}
          onClick={() => void approveUsdc(manager.address, 'manager', 'Manager')}
        />
        <ApprovalRow
          step="②"
          title="Approve Exchange (USDC)"
          desc="USDC for filling sell-side offers and posting buy-side offers."
          done={!needsExchange}
          busy={busy('exchange')}
          onClick={() => void approveUsdc(exchange.address, 'exchange', 'Exchange')}
        />
        <ApprovalRow
          step="③"
          title="Approve Exchange (outcome tokens)"
          desc="YES/NO shares for posting sell offers and filling buy-side offers."
          done={!needsOutcome}
          busy={busy('outcome')}
          onClick={() => void approveOutcomeForExchange()}
        />
      </div>
    </section>
  )
}

function ApprovalRow(props: {
  step: string
  title: string
  desc: string
  done: boolean
  busy: boolean
  onClick: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-background/60 p-2.5">
      <span
        className={cn(
          'font-bold',
          props.done ? 'text-success' : 'text-destructive',
        )}
      >
        {props.done ? <CheckCircle2 className="w-4 h-4" /> : props.step}
      </span>
      <span className="flex-1">
        <strong>{props.title}</strong> — {props.desc}
      </span>
      {props.done ? (
        <span className="text-xs font-medium text-success shrink-0">Approved</span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 h-7 text-xs px-2.5 border-primary/40 text-primary hover:bg-primary/10"
          disabled={props.busy}
          onClick={props.onClick}
        >
          {props.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Approve'}
        </Button>
      )}
    </div>
  )
}
