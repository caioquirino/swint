export type BannerState = 'connecting' | 'reconnecting' | 'unreachable' | null;

const text: Record<Exclude<BannerState, null>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting… your changes are kept and will sync when the connection is back.',
  unreachable: "Can't reach the collaboration server. Retrying…",
};

export function ConnectionBanner({ state }: { state: BannerState }) {
  if (!state) return null;
  return (
    <div
      role="status"
      className={state === 'unreachable' ? 'bg-red-50 px-4 py-2 text-sm text-red-800' : 'bg-amber-50 px-4 py-2 text-sm text-amber-900'}
    >
      {text[state]}
    </div>
  );
}
