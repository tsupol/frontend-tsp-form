// How to set up an iPhone that forwards SMS into NNF (iOS Shortcuts), as the
// admin does it on the phone: numbered steps in the Shortcuts app's own words,
// with the URL and key sitting in the step where they are entered, each with a
// copy button — a long key selected by mouse loses characters and the phone
// then fails silently. Wording follows the BE runbook
// STAFF_TRAINING/04_abm_otp_phone_setup.md.
//
// Shared by the two relays that use the same recipe: Company → ABM account OTP
// (UI_SUMMARY/137) and Company → SMS phones (UI_SUMMARY/154). They differ only
// in which SMS the automation should catch and how to test it, so the caller
// passes those two lines.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { DateTime } from './DateTime';

export interface PhoneSetupStepsProps {
  title: string;
  ingestUrl: string;
  httpMethod: string;
  /** Field names the Shortcut must POST — from the backend, never hardcoded. */
  bodyFields: { token: string; text: string; sender: string };
  /** null when there is no key to show; `missingToken` renders in its place. */
  token: string | null;
  missingToken?: ReactNode;
  tokenRotatedAt?: string | null;
  /** Step 1: which word the automation should catch. */
  filterHint: string;
  /** Step 4: how to send a test and where to look for it. */
  testHint: string;
  /** Small print under the steps. */
  footnote?: string;
}

export function PhoneSetupSteps({
  title, ingestUrl, httpMethod, bodyFields, token, missingToken, tokenRotatedAt,
  filterHint, testHint, footnote,
}: PhoneSetupStepsProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Smartphone size={15} className="text-subtle" />
        <span className="text-sm font-medium">{title}</span>
      </div>

      <Step n={1} title={t('phoneSetup.step1Title')}>
        <p>{t('phoneSetup.step1Body')}</p>
        <p>{filterHint}</p>
        <p>{t('phoneSetup.step1Run')}</p>
      </Step>

      <Step n={2} title={t('phoneSetup.step2Title')}>
        <p>{t('phoneSetup.step2Body')}</p>
        <CopyBox value={ingestUrl} small />
        <p>{t('phoneSetup.step2Options', { method: httpMethod })}</p>
      </Step>

      <Step n={3} title={t('phoneSetup.step3Title')}>
        <p>{t('phoneSetup.step3Body')}</p>
        <FieldLine name={bodyFields.token} what={t('phoneSetup.step3Token')} />
        {token ? <CopyBox value={token} /> : missingToken}
        {tokenRotatedAt && (
          <span className="text-xs text-subtle">
            {t('phoneSetup.rotatedAt')} <DateTime value={tokenRotatedAt} showTime />
          </span>
        )}
        <FieldLine name={bodyFields.text} what={t('phoneSetup.step3Text')} />
        <FieldLine name={bodyFields.sender} what={t('phoneSetup.step3Sender')} />
        <p>{t('phoneSetup.step3Chip')}</p>
      </Step>

      <Step n={4} title={t('phoneSetup.step4Title')}>
        <p>{testHint}</p>
      </Step>

      {footnote && <p className="text-xs text-subtle">{footnote}</p>}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-primary-soft text-primary-fg text-xs font-semibold flex items-center justify-center">
        {n}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 text-sm">
        <div className="font-medium">{title}</div>
        <div className="flex flex-col gap-1.5 text-subtle">{children}</div>
      </div>
    </div>
  );
}

/** A value to carry to the phone exactly — copied, never selected by mouse. */
function CopyBox({ value, small }: { value: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary-border bg-primary-soft px-3 py-2">
      <code className={`flex-1 min-w-0 font-mono text-fg break-all select-all ${small ? 'text-xs' : 'text-sm'}`}>{value}</code>
      <CopyButton value={value} size={16} className="shrink-0" />
    </div>
  );
}

/** One field of the request body: the name to type, then what goes in it. */
function FieldLine({ name, what }: { name: string; what: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <code className="font-mono text-sm text-fg rounded bg-primary-soft border border-primary-border px-2 py-0.5">{name}</code>
      <span>→ {what}</span>
    </div>
  );
}
