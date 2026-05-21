import { TradeApp } from '@/components/trade-app'

export default function TradePage({
  searchParams,
}: {
  searchParams: Promise<{ marketId?: string }>
}) {
  return <TradeApp searchParams={searchParams} />
}
