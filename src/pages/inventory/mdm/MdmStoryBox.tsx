// ============================================================================
// §3.0 — "ตอนนี้เกิดอะไรขึ้น" (what is happening now), read from
// `api.v_asset_mdm_story` (nnf-mdm migs 281–283).
//
// This box used to be assembled here out of activity_code + enforcement_* and a
// pile of FE rules. It isn't any more: the DB ships six ready-made lines, and
// this file only picks an icon and prints them.
//
// The one rule that matters (IMPLEMENT doc §9):
//   NEVER turn a *_code into words, and never re-derive the state from
//   v_asset_mdm_status. Always print the matching *_th. Changing the wording is
//   then a DB change in one place, not a hunt through the frontend.
// The codes exist ONLY to choose an icon/colour and to decide whether to poll.
//
// An empty *_th means "no such line" — hide the row, never print a blank label.
//
// <MdmStoryBox>  = the full box, top of sub-tab 2.
// <MdmStoryLines> = reason + next only, above the dunning buttons (§6), so a
//                   staffer sees what the system is already going to do before
//                   pressing anything.
// <MdmStoryBadge> = the status pill for list rows (§5).
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, PopOver, Tooltip } from 'tsp-form';
import {
  ShieldOff, PauseCircle, Loader2, ShieldAlert, WifiOff, CheckCircle2,
  Image as ImageIcon, Lock, AlertTriangle, Clock, LogIn,
} from 'lucide-react';
import type { AssetMdmStory, MdmStoryStatusCode } from './mdmApi';

type Tone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

// Icon + tone per status_code (IMPLEMENT §3). Tone drives the alert colour;
// nothing here contributes any WORDS to the screen.
const STATUS: Record<MdmStoryStatusCode, { icon: typeof ShieldAlert; tone: Tone; spin?: boolean }> = {
  NORMAL:     { icon: CheckCircle2, tone: 'success' },
  WALLPAPER:  { icon: ImageIcon,    tone: 'warning' },
  MEDIUM:     { icon: Lock,         tone: 'danger' },
  HARD:       { icon: ShieldAlert,  tone: 'danger' },
  CHANGING:   { icon: Loader2,      tone: 'info', spin: true },
  PAUSED:     { icon: PauseCircle,  tone: 'warning' },
  SILENT:     { icon: WifiOff,      tone: 'neutral' },
  // A new device waiting for its first NNF-app login (mig 370). The customer
  // did nothing wrong — informational blue, never the dunning red/orange.
  WAITING_LOGIN: { icon: LogIn,     tone: 'info' },
  NOT_IN_MDM: { icon: ShieldOff,    tone: 'neutral' },
};

// tsp-form .alert has no neutral variant — info is the closest muted tone.
const ALERT_CLASS: Record<Tone, string> = {
  info: 'alert alert-info',
  warning: 'alert alert-warning',
  danger: 'alert alert-danger',
  success: 'alert alert-success',
  neutral: 'alert alert-info',
};

// The list badge is a tsp-form <Badge> so it matches the bucket/owner badges it
// sits beside; tone maps straight onto Badge's colors (`neutral` = `default`).
// Don't hand-roll a pill here — a custom one shipped visibly taller than its
// neighbours (text-xs + py-0.5 against badge-xs's 1rem / 0.625rem).
const BADGE_COLOR: Record<Tone, 'info' | 'warning' | 'danger' | 'success' | 'default'> = {
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
  neutral: 'default',
};

function styleOf(code: MdmStoryStatusCode) {
  return STATUS[code] ?? STATUS.NORMAL;
}

/** `status_code === 'CHANGING'` is the window where a command is in flight and
 *  the row is expected to change under the user — the caller polls while true. */
export function isStoryChanging(story: AssetMdmStory | null | undefined): boolean {
  return story?.status_code === 'CHANGING';
}

/** One "label: sentence" row; renders nothing when the DB sent no sentence.
 *  No leading icon: the label already names the line, and an icon column
 *  pushed the sentences out of line with the headline above them. */
function StoryLine({ label, text, children }: {
  label: string; text: string; children?: React.ReactNode;
}) {
  if (!text) return null;
  return (
    <div className="min-w-0">
      <span className="text-subtle">{label}: </span>
      <span className="text-fg">{children ?? text}</span>
    </div>
  );
}

/** "Customer sees", tappable while apps are limited: the sentence opens the
 *  list of apps still allowed. The list comes with the story row (mig 355) —
 *  no extra request, and nothing here decides which apps those are. */
function CustomerSeesLine({ story }: { story: AssetMdmStory }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const apps = story.apps_allowed ?? [];
  const tappable = story.apps_allowed_count != null && apps.length > 0;
  return (
    <StoryLine label={t('asset.mdm.story.customerSees')} text={story.customer_sees_th}>
      {tappable ? (
        <PopOver
          isOpen={open}
          onClose={() => setOpen(false)}
          placement="bottom"
          align="start"
          maxWidth="22rem"
          maxHeight="20rem"
          trigger={
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              className="text-left underline decoration-dotted underline-offset-2 bg-transparent border-none p-0 cursor-pointer text-current"
            >
              {story.customer_sees_th}
            </button>
          }
        >
          <div className="p-3 flex flex-col gap-2">
            <div className="text-sm font-medium">
              {t('asset.mdm.story.appsAllowedTitle', { count: story.apps_allowed_count ?? apps.length })}
            </div>
            <ul className="text-sm flex flex-col gap-0.5">
              {apps.map(a => <li key={a}>{a}</li>)}
            </ul>
          </div>
        </PopOver>
      ) : story.customer_sees_th}
    </StoryLine>
  );
}

export function MdmStoryBox({ story, onGoToEnroll }: {
  story: AssetMdmStory;
  onGoToEnroll?: () => void;
}) {
  const { t } = useTranslation();
  const s = styleOf(story.status_code);
  const Icon = s.icon;

  return (
    <div className={ALERT_CLASS[s.tone]}>
      <Icon size={20} className={`shrink-0 ${s.spin ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1">
        {/* Headline, then how fresh it is right under it. Both straight from the DB. */}
        <div className="alert-title">{story.status_th}</div>
        {story.as_of_th && (
          <div className="text-xs text-subtler">{story.as_of_th}</div>
        )}

        <div className="alert-description flex flex-col gap-1 mt-1.5">
          <CustomerSeesLine story={story} />
          <StoryLine label={t('asset.mdm.story.reason')} text={story.reason_th} />
          <StoryLine label={t('asset.mdm.story.next')} text={story.next_th} />
        </div>

        {/* Something a human must go and do — its own bar, not a detail line.
            WAIT_DEVICE is the exception: nothing to do but wait for the device
            to come online, so it is a quiet grey note and offers no resend.
            HELP_CUSTOMER_LOGIN is a real job at the counter but not a problem
            with the customer, so it stays in the box's blue, not warning. */}
        {story.action_th && (story.action_code === 'WAIT_DEVICE' ? (
          <div className="mt-2 rounded-md border border-line bg-surface text-subtle px-2.5 py-1.5 text-sm inline-flex items-center gap-1.5">
            <Clock size={14} className="shrink-0" />
            <span>{story.action_th}</span>
          </div>
        ) : story.action_code === 'HELP_CUSTOMER_LOGIN' ? (
          <div className="mt-2 rounded-md border border-info-border bg-info-soft text-info-fg px-2.5 py-1.5 text-sm inline-flex items-center gap-1.5">
            <LogIn size={14} className="shrink-0" />
            <span>{story.action_th}</span>
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-warning-border bg-warning-soft text-warning-fg px-2.5 py-1.5 text-sm inline-flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{story.action_th}</span>
          </div>
        ))}

        {/* Not enrolled — point at the tab that fixes it (§3). */}
        {story.status_code === 'NOT_IN_MDM' && onGoToEnroll && (
          <button
            type="button"
            onClick={onGoToEnroll}
            className="mt-2 text-sm text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
          >
            {t('asset.mdm.story.goToEnroll')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Reason + next, for above the dunning buttons (§6). */
export function MdmStoryLines({ story }: { story: AssetMdmStory }) {
  const { t } = useTranslation();
  if (!story.reason_th && !story.next_th) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm flex flex-col gap-1">
      <StoryLine
        label={t('asset.mdm.story.reason')}
        text={story.reason_th}
      />
      <StoryLine
        label={t('asset.mdm.story.next')}
        text={story.next_th}
      />
    </div>
  );
}

/** Status pill for a list row (§5), with the customer-facing line under it.
 *  Hovering the pill reveals how fresh the reading is (`as_of_th`). */
export function MdmStoryBadge({ story, showCustomerSees = true }: {
  story: AssetMdmStory;
  showCustomerSees?: boolean;
}) {
  const s = styleOf(story.status_code);
  const Icon = s.icon;
  const pill = (
    <Badge
      size="xs"
      color={BADGE_COLOR[s.tone]}
      truncate
      startIcon={<Icon className={s.spin ? 'animate-spin' : undefined} />}
    >
      {story.status_th}
    </Badge>
  );
  return (
    <div className="min-w-0">
      {story.as_of_th ? <Tooltip content={story.as_of_th}>{pill}</Tooltip> : pill}
      {showCustomerSees && story.customer_sees_th && (
        <div className="text-xs text-subtle truncate mt-0.5">{story.customer_sees_th}</div>
      )}
    </div>
  );
}
