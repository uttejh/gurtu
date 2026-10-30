import type { PropsWithChildren, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from '@phosphor-icons/react';
import { Brand } from './Brand';

interface PageLayoutProps extends PropsWithChildren {
  title?: string;
  backTo?: string;
  headerAction?: ReactNode;
}

export function PageLayout({ children, title, backTo, headerAction }: PageLayoutProps) {
  return (
    <main className="app-frame">
      {backTo ? (
        <div className="page-topline">
          <Link className="back-link" to={backTo}>
            <ArrowLeft aria-hidden="true" weight="regular" />
            <span>Back</span>
          </Link>
          {headerAction}
        </div>
      ) : null}
      <Brand />
      {title ? <h2 className="page-title">{title}</h2> : null}
      {children}
    </main>
  );
}
