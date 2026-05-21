# Order Lifecycle (MVP)

1. Maker signs/submits an order payload to backend `/orders`.
2. Backend persists live orderbook in GCS at `orderbooks/{marketId}/live.json`.
3. Taker reads orderbook from `/orders/{marketId}`.
4. Taker executes on-chain fill via `Exchange.fillOffer` (or future batch matcher service).
5. Event-listener helper records on-chain fills into `trades/{marketId}/fills.json` (and `fills.parquet` when pyarrow is available).
6. Snapshot writer stores orderbook snapshots under `orderbooks/{marketId}/{timestamp}.json`.

## Notes

- Current implementation stores off-chain signed orders and snapshots for analytics.
- Canonical settlement remains on-chain Exchange offers/fills.
- Future extension can batch-match signed orders and submit settlements in bundles.
