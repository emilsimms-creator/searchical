import type { ReactNode } from 'react';
import './styles.css';

export const metadata = {
  title: 'Searchical approval queue',
  description: 'Every message a human reads before it reaches a candidate.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA">
      <body>
        <header className="bar">
          <a className="wordmark" href="/queue">Searchical</a>
          <span className="cut">Pilot Cut · nothing sends automatically</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
