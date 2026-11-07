import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/** A full-screen QR code to project, with the link in large type for people who can't scan. */
export function BigQr({
  link,
  title,
  onClose,
}: {
  link: string;
  title?: string;
  onClose: () => void;
}) {
  const [svg, setSvg] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })
      .then((markup) => active && setSvg(markup))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [link]);

  // A modal: focus moves in, stays in (Close is the only control), and returns on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="big-qr" role="dialog" aria-modal="true" aria-label="Audience QR code">
      {title && <p className="big-qr-title">{title}</p>}
      <p className="big-qr-prompt">Scan to read live captions in your language</p>
      {svg && (
        <div
          className="big-qr-code"
          role="img"
          aria-label="QR code for the audience link"
          // Generated locally by the qrcode library from our own URL.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <p className="big-qr-link">{link.replace(/^https?:\/\//, '')}</p>
      <button ref={closeRef} type="button" className="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
