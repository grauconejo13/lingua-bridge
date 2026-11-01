import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  link: string;
  idleMinutes?: number;
}

/** Link, QR code and share/copy buttons for inviting the other person. */
export function SharePanel({ link, idleMinutes }: Props) {
  const [svg, setSvg] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((markup) => {
        if (active) setSvg(markup);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <section className="share" aria-label="Invite the other person">
      <div className="share-text">
        <p className="share-title">Invite the other person</p>
        <p className="fine-print">
          Scan this code with their phone camera, or send them the link. Anyone with the link can
          join, so share it only with them.
          {idleMinutes ? ` The conversation ends after ${idleMinutes} minutes of inactivity.` : ''}
        </p>
        <div className="share-actions">
          {canShare && (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                void navigator
                  .share({ title: 'Lingua Bridge conversation', url: link })
                  .catch(() => undefined);
              }}
            >
              Share link
            </button>
          )}
          <button type="button" className="button" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <span className="visually-hidden" role="status">
          {copied ? 'Link copied' : ''}
        </span>
      </div>
      {svg && (
        <div
          className="qr"
          role="img"
          aria-label="QR code for the conversation link"
          // Generated locally by the qrcode library from our own URL.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </section>
  );
}
