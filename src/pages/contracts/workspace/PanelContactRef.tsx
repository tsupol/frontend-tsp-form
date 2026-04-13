import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Switch, Badge } from 'tsp-form';
import { Plus, Trash2, Star, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import type { CustomerContact, CustomerReference } from './WorkspaceTypes';

const CONTACT_TYPES = ['MOBILE', 'HOME', 'WORK', 'LINE', 'FACEBOOK', 'OTHER'];

interface Props { onClose: () => void }

export function PanelContactRef({ onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: workspace, updateData } = useWorkspace();
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
    updateData({ customerContactCount: contacts.length + 1 });
  };
  const handleContactDeleted = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-contacts', customerId] });
    updateData({ customerContactCount: Math.max(0, contacts.length - 1) });
  };
  const handleReferenceSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-references', customerId] });
    updateData({ customerReferenceCount: references.length + 1 });
  };

  if (!customerId) return null;

  return (
    <div className="p-4 flex flex-col gap-5 max-w-2xl">
      {/* Contacts */}
      <div className="flex flex-col gap-3">
        <div className="font-medium text-sm">{t('workspace.contacts')} ({contacts.length})</div>
        {contacts.map(c => <ContactRow key={c.id} contact={c} onDeleted={handleContactDeleted} />)}
        <ContactAddForm customerId={customerId} onSuccess={handleContactSuccess} />
      </div>

      <div className="border-t border-line" />

      {/* References */}
      <div className="flex flex-col gap-3">
        <div className="font-medium text-sm">
          {t('workspace.references')} ({references.length})
          {references.length === 0 && <span className="text-warning text-xs ml-2">({t('common.required')})</span>}
        </div>
        {references.map(r => (
          <div key={r.id} className="flex items-center gap-2 text-sm py-1">
            <span className="font-medium">{r.name} {r.last_name}</span>
            {r.relation && <Badge size="xs" className="bg-fg/10 text-fg/60">{r.relation}</Badge>}
            {r.tel && <span className="text-subtle tabular-nums">{r.tel}</span>}
          </div>
        ))}
        <ReferenceAddForm customerId={customerId} onSuccess={handleReferenceSuccess} />
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function ContactRow({ contact, onDeleted }: { contact: CustomerContact; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => { setDeleting(true); try { await apiClient.rpc('fn_customer_contact_delete', { p_id: contact.id }); onDeleted(); } catch {} finally { setDeleting(false); } };
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <Badge size="xs" color="info">{contact.contact_type}</Badge>
        <span className="tabular-nums">{contact.value}</span>
        {contact.is_primary && <Star size={12} className="text-warning fill-warning" />}
        {contact.label && <span className="text-control-label text-xs">({contact.label})</span>}
      </div>
      <button className="p-1 rounded hover:bg-surface-hover cursor-pointer text-control-label hover:text-danger" onClick={handleDelete} disabled={deleting}><Trash2 size={13} /></button>
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
            <label className="form-label">{t('customer.contactValue')}</label>
            <Input size="sm" value={value} onChange={e => setValue(e.target.value)} className="w-full" placeholder="095-xxx-xxxx" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer"><Switch size="sm" checked={isPrimary} onChange={e => setIsPrimary((e.target as HTMLInputElement).checked)} />{t('customer.contactPrimary')}</label>
        <Button color="primary" size="sm" onClick={handleSave} disabled={saving || !value.trim()} startIcon={<Plus size={12} />}>{t('common.add')}</Button>
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
            <Input size="sm" value={tel} onChange={e => setTel(e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="form-label">{t('customer.refRelation')}</label>
            <Input size="sm" value={relation} onChange={e => setRelation(e.target.value)} className="w-full" />
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <Button color="primary" size="sm" onClick={handleSave} disabled={saving || !name.trim()} startIcon={<Plus size={12} />}>{t('common.add')}</Button>
      </div>
    </div>
  );
}
