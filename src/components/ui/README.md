# Atlas UI actions

```tsx
import { ConfirmExpandButton, TimedUndoDelete } from '../components/ui';

// Confirm (morph button → dialog)
<ConfirmExpandButton
  triggerLabel="Valider la réception"
  title="Réception"
  description="Confirmer la réception du stock ?"
  confirmLabel="Recevoir"
  cancelLabel="Annuler"
  onConfirm={() => api.post(...)}
/>

// Delete with undo countdown (fires onConfirmDelete at 0)
<TimedUndoDelete
  deleteLabel="Supprimer"
  undoLabel="Annuler"
  initialSeconds={10}
  onConfirmDelete={() => api.delete(...)}
/>
```

Run `npm install` after pull (adds `motion`, `lucide-react`).


## Navigation / chrome

```tsx
import {
  CarouselNavigator,
  AppDock,
  ExpandDetails,
  FeedbackAction,
} from '../components/ui';

// Pagination (WhatsNew, onboarding, mail attachment preview…)
const [i, setI] = useState(0);
<CarouselNavigator totalSlides={5} currentIndex={i} onIndexChange={setI} autoDelay={5000} />

// Dock
<AppDock
  items={[
    { id: 'p', label: 'Produits', icon: <Package size={22} />, onClick: () => navigate('/products') },
  ]}
/>

// Expand meta
<ExpandDetails title="Détails" rows={[
  { label: 'Modèle', value: 'GPT' },
  { label: 'Latence', value: '1.4s' },
]} />

// Sync error + retry
<FeedbackAction
  status={err ? 'error' : loading ? 'loading' : 'idle'}
  errorMessage="Échec de la synchro"
  onRetry={() => reload()}
/>
```
