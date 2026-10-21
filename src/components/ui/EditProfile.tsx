import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Pencil, Clock, ChevronDown } from 'lucide-react';

export type ProfileData = {
  fullName: string;
  email: string;
  timezone: string;
  workingHours: string;
  title: string;
  avatarUrl: string;
  lastUpdated: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialData: ProfileData;
  onSave: (data: ProfileData) => void | Promise<void>;
};

/** Center-square crop → circular JPEG data URL (256px) */
async function cropToCircleDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Lecture impossible'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Image illisible'));
    i.src = dataUrl;
  });
  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!side) throw new Error('Image vide');
  const sx = ((img.naturalWidth || img.width) - side) / 2;
  const sy = ((img.naturalHeight || img.height) - side) / 2;
  const out = 256;
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.clearRect(0, 0, out, out);
  ctx.beginPath();
  ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  // v243 — WebP first (~3x smaller than JPEG at same quality): faster avatar
  // uploads AND loads; falls back to JPEG where WebP encoding is unsupported.
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.92);
}

export const EditProfile: FC<Props> = ({ isOpen, onClose, initialData, onSave }) => {
  const [formData, setFormData] = useState<ProfileData>(initialData);
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropPreview, setCropPreview] = useState<string | null>(null);
  const [cropError, setCropError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => setMounted(true), []);

  // Only reset form when dialog opens — not on every initialData identity change (that killed crop UI)
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setFormData(initialData);
      setCropPreview(null);
      setCropError('');
    }
    if (!isOpen) {
      setCropPreview(null);
      setCropError('');
      setCropBusy(false);
    }
    wasOpen.current = isOpen;
  }, [isOpen, initialData]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (cropPreview) {
        e.preventDefault();
        e.stopPropagation();
        setCropPreview(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose, cropPreview]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setCropError('Choisissez un fichier image (JPG, PNG, WebP…).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setCropError('Image trop lourde (max 8 Mo).');
      return;
    }
    setCropError('');
    setCropBusy(true);
    try {
      const url = await cropToCircleDataUrl(file);
      setCropPreview(url);
    } catch (err: any) {
      setCropError(err?.message || 'Recadrage impossible. Réessayez avec une autre image.');
      setCropPreview(null);
    } finally {
      setCropBusy(false);
    }
  };

  const applyCrop = () => {
    if (!cropPreview) return;
    setFormData((p) => ({ ...p, avatarUrl: cropPreview }));
    setCropPreview(null);
    setCropError('');
  };

  const submit = async () => {
    try {
      setSaving(true);
      await onSave(formData);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!mounted || typeof document === 'undefined') return null;

  const cropLayer =
    cropPreview &&
    createPortal(
      <div
        className="ac-avatar-crop-root"
        role="dialog"
        aria-modal="true"
        aria-label="Recadrer la photo"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="ac-avatar-crop-card"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <h3>Recadrage</h3>
          <p className="muted">Recadrage centré en cercle (carré source).</p>
          <div className="ac-avatar-crop-preview">
            <img src={cropPreview} alt="Aperçu recadré" draggable={false} />
          </div>
          <div className="ac-avatar-crop-actions">
            <button type="button" className="secondary" onClick={() => setCropPreview(null)}>
              Annuler
            </button>
            <button type="button" className="ac-avatar-crop-apply" onClick={applyCrop}>
              Utiliser cette photo
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <div className="ac-edit-profile-root" role="dialog" aria-modal="true" aria-labelledby="ac-edit-profile-title">
              <motion.div
                className="ac-edit-profile-backdrop"
                role="presentation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                aria-hidden
                onClick={() => {
                  // Never dismiss profile while crop is open
                  if (cropPreview) return;
                  onClose();
                }}
              />
              <motion.div
                className="ac-edit-profile-modal"
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ type: 'spring', damping: 24, stiffness: 340 }}
                onClick={(e) => e.stopPropagation()}
              >
                <header className="ac-edit-profile-head">
                  <h2 id="ac-edit-profile-title">Modifier le profil</h2>
                  <button type="button" className="ac-edit-profile-close secondary" onClick={onClose} aria-label="Fermer">
                    <X size={18} />
                  </button>
                </header>

                <div className="ac-edit-profile-body">
                  <div className="ac-edit-profile-form">
                    <label>
                      Nom complet
                      <input name="fullName" value={formData.fullName} onChange={handleChange} autoComplete="name" />
                    </label>
                    <label>
                      E-mail
                      <input name="email" type="email" value={formData.email} onChange={handleChange} autoComplete="email" />
                    </label>
                    <div className="ac-edit-profile-row">
                      <label>
                        Fuseau horaire
                        <span className="ac-edit-profile-select-wrap">
                          <select name="timezone" value={formData.timezone} onChange={handleChange}>
                            <option value="Africa/Casablanca">Maroc (Casablanca)</option>
                            <option value="Europe/Paris">Europe/Paris</option>
                            <option value="UTC">UTC</option>
                          </select>
                          <ChevronDown size={16} className="ac-edit-profile-chev" aria-hidden />
                        </span>
                      </label>
                      <label>
                        Horaires
                        <span className="ac-edit-profile-input-ico">
                          <input name="workingHours" value={formData.workingHours} onChange={handleChange} placeholder="09:00 – 18:00" />
                        </span>
                      </label>
                    </div>
                    <label>
                      Fonction
                      <input name="title" value={formData.title} onChange={handleChange} placeholder="Gérant, comptable…" />
                    </label>
                  </div>

                  <div className="ac-edit-profile-preview">
                    <span className="ac-edit-profile-preview-label">Photo de profil</span>
                    <button
                      type="button"
                      className="ac-edit-profile-avatar-wrap ac-edit-profile-avatar-btn"
                      onClick={() => fileRef.current?.click()}
                      disabled={cropBusy}
                      title="Changer la photo"
                    >
                      {formData.avatarUrl ? (
                        <img src={formData.avatarUrl} alt="" className="ac-edit-profile-avatar" />
                      ) : (
                        <div className="ac-edit-profile-avatar ac-edit-profile-avatar--ini">
                          {(formData.fullName || '?').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="ac-edit-profile-pencil" aria-hidden>
                        <Pencil size={14} />
                      </span>
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        e.target.value = '';
                        void onPickFile(f);
                      }}
                    />
                    <button
                      type="button"
                      className="secondary ac-edit-profile-change-photo"
                      onClick={() => fileRef.current?.click()}
                      disabled={cropBusy}
                    >
                      {cropBusy ? 'Recadrage…' : 'Changer la photo'}
                    </button>
                    {cropError ? <span className="field-error">{cropError}</span> : null}
                    <strong>{formData.fullName || '—'}</strong>
                    <p>{formData.title || '—'}</p>
                    <span className="ac-edit-profile-hours">
                      <Clock size={12} /> {formData.workingHours || '—'}
                    </span>
                  </div>
                </div>

                <footer className="ac-edit-profile-foot">
                  <span className="ac-edit-profile-updated">
                    {formData.lastUpdated ? `Mis à jour : ${formData.lastUpdated}` : 'Non enregistré'}
                  </span>
                  <div className="ac-edit-profile-actions">
                    <button type="button" className="secondary" onClick={onClose} disabled={saving}>
                      Annuler
                    </button>
                    <button type="button" className="secondary ac-edit-profile-save" onClick={() => void submit()} disabled={saving}>
                      {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                </footer>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
      {cropLayer}
    </>
  );
};

export default EditProfile;
