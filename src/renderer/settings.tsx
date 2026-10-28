import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SummonEnsoButton, TitleBar } from '@/components/app/TitleBar';
import { OauthCredentialBootstrap } from '@/components/oauth/OauthCredentialBootstrap';
import { SettingsContent } from '@/components/settings';
import { ToastProvider } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import './styles/globals.css';

function SettingsApp() {
  const { t } = useI18n();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-shell" data-slot="settings-window">
      <OauthCredentialBootstrap />
      <TitleBar title={t('Settings')} actions={<SummonEnsoButton label={false} />} />
      <main className="min-h-0 flex-1 overflow-hidden">
        <SettingsContent />
      </main>
      <ToastProvider />
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
);
