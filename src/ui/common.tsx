import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Table2, LineChart, BarChart3, FileCode2, FlaskConical, StickyNote, ChevronDown, ChevronRight, X, Image as ImageIcon,
} from 'lucide-react';
import type { ItemType } from '../model/types';

export function ItemIcon({ type, size = 15 }: { type: ItemType; size?: number }) {
  const props = { size, strokeWidth: 1.9 };
  switch (type) {
    case 'table': return <Table2 {...props} color="#2f6fed" />;
    case 'analysis': return <FlaskConical {...props} color="#8a4fd8" />;
    case 'graph': return <BarChart3 {...props} color="#1f9d55" />;
    case 'script': return <FileCode2 {...props} color="#d9822b" />;
    case 'figure': return <LineChart {...props} color="#0e9aa7" />;
    case 'info': return <StickyNote {...props} color="#b8860b" />;
  }
}

export function Modal({ title, icon, children, footer, onClose, size }: { title: ReactNode; icon?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; size?: 'wide' | 'narrow' }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon}
          <span className="grow">{title}</span>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, icon }: { title: string; children: ReactNode; defaultOpen?: boolean; icon?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fsection">
      <div className="fsection-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {title}
      </div>
      {open && <div className="fsection-body">{children}</div>}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
  disabled?: boolean;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);
  const element = menu ? (
    <div className="ctxmenu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - menu.items.length * 32 - 10) }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) =>
        it.sep ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={() => {
              setMenu(null);
              it.onClick?.();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>
  ) : null;
  return { open: (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => {
    e.preventDefault?.();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, element };
}

export function Splitter({ dir, onDrag }: { dir: 'v' | 'h'; onDrag: (delta: number) => void }) {
  const start = useRef(0);
  return (
    <div
      className={dir === 'v' ? 'splitter-v' : 'splitter-h'}
      onMouseDown={(e) => {
        start.current = dir === 'v' ? e.clientX : e.clientY;
        const move = (ev: MouseEvent) => {
          const p = dir === 'v' ? ev.clientX : ev.clientY;
          onDrag(p - start.current);
          start.current = p;
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          document.body.style.cursor = '';
        };
        document.body.style.cursor = dir === 'v' ? 'col-resize' : 'row-resize';
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    />
  );
}

export function NumberInput({ value, onChange, placeholder, step, style }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; step?: number; style?: React.CSSProperties }) {
  const [text, setText] = useState(value === undefined || Number.isNaN(value) ? '' : String(value));
  useEffect(() => {
    setText(value === undefined || Number.isNaN(value) ? '' : String(value));
  }, [value]);
  return (
    <input
      className="input"
      style={style}
      value={text}
      placeholder={placeholder}
      inputMode="decimal"
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = text.trim();
        if (t === '') onChange(undefined);
        else {
          const n = Number(t);
          if (Number.isFinite(n)) onChange(n);
          else setText(value === undefined ? '' : String(value));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function SvgView({ svg, className, style, onClick }: { svg: string; className?: string; style?: React.CSSProperties; onClick?: (e: React.MouseEvent) => void }) {
  return <div className={className} style={style} onClick={onClick} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export { ImageIcon };
