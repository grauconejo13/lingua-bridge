import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BigQr } from './BigQr';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Show QR
      </button>
      <button type="button">Elsewhere</button>
      {open && (
        <BigQr link="https://example.test/t/abc" title="Demo" onClose={() => setOpen(false)} />
      )}
    </>
  );
}

describe('BigQr', () => {
  it('traps focus while open and returns it to the opener on close', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Show QR' });
    await userEvent.click(opener);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('shows the link in text for people who cannot scan', () => {
    render(<BigQr link="https://example.test/t/abc" onClose={() => undefined} />);
    expect(screen.getByText('example.test/t/abc')).toBeInTheDocument();
  });
});
