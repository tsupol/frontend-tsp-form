import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, MaskedInput, Select, Switch, Badge, useSnackbarContext } from 'tsp-form';
import { translateApiError } from '../../../lib/apiErrors';
import { Plus, Trash2, Star, XCircle, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import { PanelSection } from './PanelSection';
import type { CustomerContact, CustomerReference } from './WorkspaceTypes';

const thaiPhoneMask = (digits: string) => {
  if (digits.startsWith('02')) return '##-###-####';
  const prefix = digits.slice(0, 2);
  if (['03','04','05','07'].includes(prefix)) return '###-###-###';
  return '###-###-####'; // mobile 06x, 08x, 09x
};

const CONTACT_TYPES = ['MOBILE', 'HOME', 'WORK', 'LINE', 'FACEBOOK', 'OTHER'];
const PHONE_TYPES = new Set(['MOBILE', 'HOME', 'WORK']);

interface Props { onClose: () => void }

export function PanelContactRef({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: workspace, invalidateCustomer } = useWorkspace();
  const customerId = workspace.customerId;

  const { data: contacts = [] } = useQuery({
    queryKey: ['customer-contacts', customerId],
    queryFn: () => apiClient.get<CustomerContact[]>(`/v_customer_contacts?customer_id=eq.${customerId}&order=is_primary.desc,contact_type`),
    enabled: !!customerId,
  });

  const { data: references = [] } = useQuery({
    queryKey: ['customer-references', customerId],
    queryFn: () => apiClient.get<CustomerReference[]>(`/v_customer_references?customer_id=eq.${customerId}&order=id`),
    enabled: !!customerId,
  });

  const handleContactSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    invalidateCustomer();
  };
  const handleContactDeleted = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    invalidateCustomer();
  };
  const handleReferenceSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-references', customerId] });
    invalidateCustomer();
  };
  const handleReferenceDeleted = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-references', customerId] });
    invalidateCustomer();
  };

  if (!customerId) return null;

  return (
    <div className="p-4 flex flex-col max-w-2xl">
      <PanelSection title={t('workspace.contacts')} count={contacts.length}>
        {contacts.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {contacts.map(c => <ContactRow key={c.id} contact={c} onDeleted={handleContactDeleted} />)}
          </div>
        )}
        <ContactAddForm customerId={customerId} onSuccess={handleContactSuccess} />
      </PanelSection>

      <PanelSection
        title={t('workspace.references')}
        count={references.length}
        className="mt-6"
        alert={references.length === 0 ? (
          <div className="alert alert-warning"><AlertTriangle size={14} /><span>{t('workspace.refRequired')}</span></div>
        ) : undefined}
      >
        {references.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {references.map(r => (
              <ReferenceRow key={r.id} reference={r} onDeleted={handleReferenceDeleted} />
            ))}
          </div>
        )}
        <ReferenceAddForm customerId={customerId} onSuccess={handleReferenceSuccess} />
      </PanelSection>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function ContactRow({ contact, onDeleted }: { contact: CustomerContact; onDeleted: () => void }) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.rpc('fn_customer_contact_delete', { p_id: contact.id });
      onDeleted();
    } catch (err) {
      // A delete that does nothing with no feedback reads as success — surface it.
      const msg = err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err));
      addSnackbar({ message: <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{msg}</div></div></div> });
    } finally { setDeleting(false); }
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2 border border-success-border bg-success-soft rounded-lg text-sm">
      <Badge size="xs" color="info">{contact.contact_type}</Badge>
      <span className="tabular-nums flex-1">{contact.value}</span>
      {contact.is_primary && <Star size={12} className="text-warning-fg fill-warning shrink-0" />}
      {contact.label && <span className="text-subtle text-xs shrink-0">({contact.label})</span>}
      <button className="p-1 rounded hover:bg-surface-hover cursor-pointer text-subtle hover:text-danger shrink-0 bg-transparent border-none" onClick={handleDelete} disabled={deleting}><Trash2 size={13} /></button>
    </div>
  );
}

function ReferenceRow({ reference, onDeleted }: { reference: CustomerReference; onDeleted: () => void }) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.delete(`/v_customer_references?id=eq.${reference.id}`);
      onDeleted();
    } catch (err) {
      const msg = err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err));
      addSnackbar({ message: <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{msg}</div></div></div> });
    } finally { setDeleting(false); }
  };
  return (
    <div className="border border-success-border bg-success-soft rounded-lg overflow-hidden transition-colors">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-hover transition-colors" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} className="text-subtle shrink-0" /> : <ChevronRight size={14} className="text-subtle shrink-0" />}
        <span className="font-medium text-sm flex-1 truncate">{reference.name} {reference.last_name}</span>
        {reference.relation && <Badge size="xs" color="default">{reference.relation}</Badge>}
        <button
          className="p-1 rounded hover:bg-danger/10 cursor-pointer text-subtle hover:text-danger shrink-0 bg-transparent border-none"
          onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          disabled={deleting}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-line px-3 py-2 text-sm flex flex-col gap-1">
          {reference.tel && (
            <div className="flex gap-2">
              <span className="text-subtle w-16 shrink-0">{t('customer.refTel')}</span>
              <span className="tabular-nums">{reference.tel}</span>
            </div>
          )}
          {reference.relation && (
            <div className="flex gap-2">
              <span className="text-subtle w-16 shrink-0">{t('customer.refRelation')}</span>
              <span>{reference.relation}</span>
            </div>
          )}
          {!reference.tel && !reference.relation && (
            <span className="text-subtle text-xs">{t('common.noData')}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ContactAddForm({ customerId, onSuccess }: { customerId: number; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [contactType, setContactType] = useState('MOBILE');
  const [value, setValue] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const typeOptions = CONTACT_TYPES.map(ct => ({ value: ct, label: ct }));
  const handleSave = async () => {
    if (!value.trim()) return; setSaving(true); setError('');
    try {
      await apiClient.rpc('fn_customer_contact_upsert', { p_customer_id: customerId, p_contact_type: contactType, p_value: value.trim(), p_label: null, p_is_primary: isPrimary, p_note: null });
      setValue(''); setIsPrimary(false); onSuccess();
    } catch (err) {
      if (err instanceof ApiError) { const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : ''); setError(tr || err.code || err.message); } else setError(String(err));
    } finally { setSaving(false); }
  };
  return (
    <div className="p-3 rounded-md border border-dashed border-line">
      {error && <div className="alert alert-danger text-xs mb-3"><XCircle size={14} /><span>{error}</span></div>}
      <div className="form-grid">
        <div className="flex gap-3">
          <div className="flex flex-col" style={{ width: '8rem' }}>
            <label className="form-label">{t('customer.contactType')}</label>
            <Select size="sm" options={typeOptions} value={contactType} onChange={v => setContactType(v as string)} showChevron searchable={false} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <label className="form-label">{PHONE_TYPES.has(contactType) ? t('wizard.tel') : contactType}</label>
            {PHONE_TYPES.has(contactType) ? (
              <MaskedInput size="sm" dynamicMask={thaiPhoneMask} value={value} onChange={(raw) => setValue(raw)} className="w-full" />
            ) : (
              <Input size="sm" value={value} onChange={e => setValue(e.target.value)} className="w-full" />
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs cursor-pointer"><Switch size="sm" checked={isPrimary} onChange={e => setIsPrimary((e.target as HTMLInputElement).checked)} />{t('customer.contactPrimary')}</label>
        <Button color="primary" onClick={handleSave} disabled={saving || !value.trim()} startIcon={<Plus size={12} />}>{t('common.add')}</Button>
      </div>
    </div>
  );
}

function ReferenceAddForm({ customerId, onSuccess }: { customerId: number; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [tel, setTel] = useState('');
  const [relation, setRelation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true); setError('');
    try {
      await apiClient.rpc('fn_customer_reference_add', { p_customer_id: customerId, p_name: name.trim(), p_last_name: lastName.trim() || null, p_tel: tel.trim() || null, p_relation: relation.trim() || null, p_facebook: null, p_line_id: null });
      setName(''); setLastName(''); setTel(''); setRelation(''); onSuccess();
    } catch (err) {
      if (err instanceof ApiError) { const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : ''); setError(tr || err.code || err.message); } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <div className="p-3 rounded-md border border-dashed border-line">
      {error && <div className="alert alert-danger text-xs mb-3"><XCircle size={14} /><span>{error}</span></div>}
      <div className="form-grid">
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refName')} *</label>
            <Input size="sm" value={name} onChange={e => setName(e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refLastName')}</label>
            <Input size="sm" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refTel')}</label>
            <MaskedInput size="sm" dynamicMask={thaiPhoneMask} value={tel} onChange={(raw) => setTel(raw)} className="w-full" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refRelation')}</label>
            <Input size="sm" value={relation} onChange={e => setRelation(e.target.value)} className="w-full" />
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button color="primary" onClick={handleSave} disabled={saving || !name.trim()} startIcon={<Plus size={12} />}>{t('common.add')}</Button>
      </div>
    </div>
  );
}
