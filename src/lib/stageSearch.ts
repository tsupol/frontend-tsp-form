import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// What is typed in the search box of the stage page on screen. The shop's
// stage tab row reads it when a tab is pressed and hands it to the next page
// through the navigation state, so a contract number typed once follows the
// user from stage to stage. Any other way of arriving (side menu, link, typed
// address) carries no state and starts with an empty box.
let live = '';

export const STAGE_SEARCH_STATE = 'stageSearch';

export function liveStageSearch(): string {
  return live;
}

/** Drop-in for the `useState('')` behind a stage page's search box. */
export function useStageSearch(): [string, (next: string) => void] {
  const location = useLocation();
  const [value, setValue] = useState<string>(() => {
    const carried = (location.state as Record<string, unknown> | null)?.[STAGE_SEARCH_STATE];
    return typeof carried === 'string' ? carried : '';
  });
  useEffect(() => { live = value; }, [value]);
  return [value, setValue];
}
