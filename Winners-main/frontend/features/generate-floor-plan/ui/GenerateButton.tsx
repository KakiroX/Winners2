'use client';

interface Props {
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function GenerateButton({ loading, disabled, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="px-6 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-slate-700 transition-colors"
    >
      {loading ? 'Generating…' : 'Generate'}
    </button>
  );
}
