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

import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from 'tsp-form';
import {
  ShieldOff, PauseCircle, Loader2, ShieldAlert, WifiOff, CheckCircle2,
  Image as ImageIcon, Lock, AlertTriangle, Eye, ArrowRight, Clock,
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

/** One "label: sentence" row; renders nothing when the DB sent no sentence. */
function StoryLine({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-1.5">
      <span className="shrink-0 mt-0.5 opacity-70">{icon}</span>
      <div className="min-w-0">
        <span className="text-subtle">{label}: </span>
        {text}
      </div>
    </div>
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
        {/* Headline + how fresh it is. Both straight from the DB. */}
        <div className="alert-title flex items-baseline justify-between gap-3 flex-wrap">
          <span>{story.status_th}</span>
          {story.as_of_th && (
            <span className="text-xs font-normal text-subtle inline-flex items-center gap-1">
              <Clock size={11} />{story.as_of_th}
            </span>
          )}
        </div>

        <div className="alert-description flex flex-col gap-1 mt-1">
          <StoryLine
            icon={<Eye size={13} />}
            label={t('asset.mdm.story.customerSees')}
            text={story.customer_sees_th}
          />
          <StoryLine
            icon={<AlertTriangle size={13} />}
            label={t('asset.mdm.story.reason')}
            text={story.reason_th}
          />
          <StoryLine
            icon={<ArrowRight size={13} />}
            label={t('asset.mdm.story.next')}
            text={story.next_th}
          />
        </div>

        {/* Something a human must go and do — its own bar, not a detail line. */}
        {story.action_th && (
          <div className="mt-2 rounded-md border border-warning-border bg-warning-soft text-warning-fg px-2.5 py-1.5 text-sm inline-flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{story.action_th}</span>
          </div>
        )}

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
        icon={<AlertTriangle size={13} />}
        label={t('asset.mdm.story.reason')}
        text={story.reason_th}
      />
      <StoryLine
        icon={<ArrowRight size={13} />}
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
