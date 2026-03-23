# Navigation Guard Pattern

Prevents losing unsaved changes when navigating away from an editor page.

## Architecture

Since this app uses `BrowserRouter` (not a data router), `useBlocker` from react-router is not available. Instead we use a custom `NavGuardContext`.

### Files

- **`src/contexts/NavGuardContext.tsx`** — context provider with `guardedNavigate()` and confirm Modal
- **`src/hooks/useFormSnapshot.ts`** — generic dirty tracking hook for non-react-hook-form editors
- **`src/main.tsx`** — `NavGuardProvider` wraps `<App />` inside `<BrowserRouter>`
- **`src/AppSideNav.tsx`** — `handleSelect` and `linkFn` use `guardedNavigate`

### How it works

1. **Page registers a dirty ref:** The editor page creates a `useRef(false)` and registers it via `navGuard.setDirtyRef(ref)` on mount
2. **Editor tracks dirty state:** Uses `useFormSnapshot` hook — pass all form values, get `isDirty` back automatically
3. **Editor syncs dirty to parent:** A `useEffect` copies `snapshot.isDirty` into `isDirtyRef.current`
4. **Navigation is intercepted:** All nav entry points use `navGuard.guardedNavigate(path)` instead of `navigate(path)`. If the dirty ref is true, the context stores the pending path and shows a confirm Modal
5. **User decides:** Cancel resets the pending path. Discard clears the dirty ref and navigates

### Protection layers

| Scenario | Mechanism |
|---|---|
| Click different model in list | `pendingNav` state in the page component |
| Mobile back button | `pendingNav` state in the page component |
| Pricing sidebar nav | `PricingLayout` uses `guardedNavigate` instead of `NavLink` |
| Main sidebar nav | `AppSideNav` uses `guardedNavigate` in `handleSelect` and `linkFn` |
| Browser close/refresh | `beforeunload` event in the editor component |

## `useFormSnapshot` — Dirty Tracking Hook

Generic dirty tracking for editors that don't use `react-hook-form`. Works with any data shape — strings, numbers, dynamic records, arrays.

### API

```tsx
const snapshot = useFormSnapshot({ retailPrice, costPrice, fin2Profits });

snapshot.isDirty    // true if current values differ from last snapshot
snapshot.reset()    // take snapshot of current values (call after successful save)
snapshot.resetNext() // take snapshot on next render (call when setState hasn't flushed yet)
```

### How it works internally

- Compares values via `JSON.stringify` with sorted keys (handles dynamic records like `{ 12: "500", 24: "1000" }`)
- `reset()` — stores current stringified values as baseline. Call after a successful API save (optimistic — save succeeded, current values are the new baseline)
- `resetNext()` — flags that the next render should take a snapshot. Call inside `useEffect` that sets state, since the state hasn't flushed yet on the current render
- `isDirty` is false until the first `reset()`/`resetNext()` is called (avoids false positives before init)

### Usage pattern

```tsx
function EditorPanel({ isDirtyRef, ...props }) {
  const [retailPrice, setRetailPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [fin2Profits, setFin2Profits] = useState<Record<number, string>>({});

  const snapshot = useFormSnapshot({ retailPrice, costPrice, fin2Profits });

  // After initializing form from server data:
  useEffect(() => {
    setRetailPrice(serverData.retail);
    setCostPrice(serverData.cost);
    snapshot.resetNext(); // snapshot next render when state has settled
  }, [serverData]);

  // Sync dirty to parent
  useEffect(() => {
    if (isDirtyRef) isDirtyRef.current = snapshot.isDirty;
  }, [snapshot.isDirty, isDirtyRef]);

  // After successful save:
  const handleSave = async () => {
    await apiClient.rpc('save', payload);
    snapshot.reset(); // optimistic — current values are now the baseline
  };
}
```

### Adding a new field

Just add it to the `useFormSnapshot` call — no manual comparison logic needed:

```tsx
// Before:
const snapshot = useFormSnapshot({ retailPrice, costPrice, fin2Profits });

// After adding a field:
const snapshot = useFormSnapshot({ retailPrice, costPrice, fin2Profits, newField });
```

## Adding guard to a new page

1. In your page component:
   ```tsx
   const navGuard = useNavGuard();
   const editorDirtyRef = useRef(false);
   useEffect(() => { navGuard?.setDirtyRef(editorDirtyRef); }, [navGuard]);
   ```

2. In your editor component, use `useFormSnapshot` + sync to `isDirtyRef`:
   ```tsx
   const snapshot = useFormSnapshot({ field1, field2 });

   // After init:
   snapshot.resetNext();

   // Sync dirty to parent:
   useEffect(() => {
     if (isDirtyRef) isDirtyRef.current = snapshot.isDirty;
   }, [snapshot.isDirty, isDirtyRef]);

   // After save:
   snapshot.reset();
   ```

3. Guard in-page actions (e.g. switching selected item):
   ```tsx
   if (editorDirtyRef.current) {
     setPendingNav({ type: 'item', itemId });
     return;
   }
   ```

4. If the page's parent layout uses `NavLink`, replace with `<a>` + `guardedNavigate` (see `PricingLayout.tsx`)

## Guarding modal close

For modals with forms (especially `react-hook-form`), guard the close action using `formState.isDirty`:

```tsx
function CreateSomethingModal({ open, onClose }) {
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const { formState: { isDirty }, reset, ...form } = useForm({ ... });

  const handleClose = () => {
    if (isDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };

  const forceClose = () => {
    reset();
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
    <Modal open={open} onClose={handleClose}>
      {/* form content, cancel button calls handleClose */}
    </Modal>

    <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}
```

Key points:
- The main Modal's `onClose` uses `handleClose` (guarded), so backdrop clicks are also protected
- `forceClose` resets the form, closes the confirm modal, then closes the main modal
- No `NavGuardContext` needed — this is self-contained within the modal component

## Reference

- **PricebookPage** (`src/pages/pricing/PricebookPage.tsx`) — page-level guard with `useFormSnapshot`
- **CreateModelModal** (`src/pages/products/ModelsPage.tsx`) — modal close guard with `react-hook-form`
- **Online-course project** (`D:\dev\online-course-prototype-frontend`) — original inspiration (CourseDetailPage, ProfileLayout)

## i18n keys

- `common.unsavedChanges` — modal title
- `common.unsavedChangesMessage` — modal body
- `common.discard` — discard button label
