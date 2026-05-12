import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Input, Select, Button, InputDatePicker, Badge } from 'tsp-form';
import { AlertTriangle, ShieldAlert, CheckCircle, XCircle, Keyboard, ChevronDown, ChevronRight, Plus, Trash2, Star, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { toLocalDateStr, parseLocalDate } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { AddressFormPostal } from './AddressFormPostal';
import type { CustomerRegisterResult, CustomerAddress, CustomerContact, CustomerReference } from './WorkspaceTypes';

// ── Constants ────────────────────────────────────────────────────────────

const ID_TYPE_OPTIONS = [
  { value: 'CITIZEN_ID', label: 'Citizen ID' },
  { value: 'PASSPORT', label: 'Passport' },
];

const PREFIX_OPTIONS = [
  { value: '', label: '-' },
  { value: 'นาย', label: 'นาย' },
  { value: 'นาง', label: 'นาง' },
  { value: 'นางสาว', label: 'นางสาว' },
  { value: 'Mr.', label: 'Mr.' },
  { value: 'Mrs.', label: 'Mrs.' },
  { value: 'Ms.', label: 'Ms.' },
];

const CONTACT_TYPES = ['MOBILE', 'HOME', 'WORK', 'LINE', 'FACEBOOK', 'OTHER'];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ModalCustomer({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();

  // Form state
  const [idType, setIdType] = useState<'CITIZEN_ID' | 'PASSPORT'>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tel, setTel] = useState('');
  const [tel2, setTel2] = useState('');
  const [isTypingDob, setIsTypingDob] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [result, setResult] = useState<CustomerRegisterResult | null>(workspace.customerResult);

  // The customer ID we're working with (from workspace or just registered)
  const customerId = workspace.customerId;

  // Expandable sections
  const [showAddressHome, setShowAddressHome] = useState(false);
  const [showAddressWork, setShowAddressWork] = useState(false);
  const [showAddressShipping, setShowAddressShipping] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showReferences, setShowReferences] = useState(false);

  // Fetch customer addresses
  const { data: addresses = [], refetch: refetchAddresses } = useQuery({
    queryKey: ['customer-addresses', customerId],
    queryFn: () => apiClient.get<CustomerAddress[]>(`/v_customer_addresses?customer_id=eq.${customerId}&order=address_type`),
    enabled: !!customerId,
  });

  // Fetch contacts
  const { data: contacts = [], refetch: refetchContacts } = useQuery({
    queryKey: ['customer-contacts', customerId],
    queryFn: () => apiClient.get<CustomerContact[]>(`/v_customer_contacts?customer_id=eq.${customerId}&order=is_primary.desc,contact_type`),
    enabled: !!customerId,
  });

  // Fetch references
  const { data: references = [], refetch: refetchReferences } = useQuery({
    queryKey: ['customer-references', customerId],
    queryFn: () => apiClient.get<CustomerReference[]>(`/v_customer_references?customer_id=eq.${customerId}&order=id`),
    enabled: !!customerId,
  });

  const homeAddress = addresses.find(a => a.address_type === 'HOME');
  const workAddress = addresses.find(a => a.address_type === 'WORK');
  const shippingAddress = addresses.find(a => a.address_type === 'SHIPPING');

  // Validation
  const errors: Record<string, string> = {};
  if (!idNumber.trim()) errors.id_number = t('common.required');
  if (!firstName.trim()) errors.first_name = t('common.required');
  if (!lastName.trim()) errors.last_name = t('common.required');
  if (!tel.trim()) errors.tel = t('common.required');

  const handleRegister = async () => {
    if (Object.keys(errors).length > 0 && !idNumber.trim()) return;
    setSubmitting(true);
    setApiError('');

    try {
      const res = await apiClient.rpc<CustomerRegisterResult>('fn_customer_register_or_update', {
        p_id_type: idType,
        p_id_number: idNumber.trim(),
        p_prefix: prefix || null,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_date_of_birth: dateOfBirth || null,
        p_tel: tel.trim(),
        p_tel2: tel2.trim() || null,
      });

      setResult(res);

      if (res.action !== 'BLOCK') {
        updateData({
          customerId: res.customer_id,
          customerName: res.full_name,
          customerResult: res,
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(translated || err.message);
      } else {
        setApiError(String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddressSuccess = (type: 'HOME' | 'WORK' | 'SHIPPING') => {
    refetchAddresses();
    const updatedAddresses = { ...workspace.customerAddresses };
    if (type === 'HOME') {
      updatedAddresses.home = true;
      setShowAddressHome(false);
    } else if (type === 'WORK') {
      updatedAddresses.work = true;
      setShowAddressWork(false);
    } else {
      updatedAddresses.shipping = true;
      setShowAddressShipping(false);
    }
    updateData({ customerAddresses: updatedAddresses });
  };

  const handleContactSuccess = () => {
    refetchContacts();
    updateData({ customerContactCount: contacts.length + 1 });
  };

  const handleContactDeleted = () => {
    refetchContacts();
    updateData({ customerContactCount: Math.max(0, contacts.length - 1) });
  };

  const handleReferenceSuccess = () => {
    refetchReferences();
    updateData({ customerReferenceCount: references.length + 1 });
  };

  const handleClose = () => {
    // Sync final counts
    updateData({
      customerAddresses: { home: !!homeAddress, work: !!workAddress, shipping: !!shippingAddress },
      customerContactCount: contacts.length,
      customerReferenceCount: references.length,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('workspace.cardCustomer')}</h2>
      </div>
      <div className="modal-content" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <div className="flex flex-col gap-5">
          {/* API Error */}
          {apiError && (
            <div className="alert alert-danger">
              <XCircle size={18} />
              <div><div className="alert-description">{apiError}</div></div>
            </div>
          )}

          {/* Result banner */}
          {result && <ResultBanner result={result} t={t} />}

          {/* ── Main customer form ── */}
          <div className="form-grid">
            <div className="flex gap-3">
              <div className="flex flex-col" style={{ width: '10rem' }}>
                <label className="form-label">{t('wizard.idType')}</label>
                <Select
                  options={ID_TYPE_OPTIONS}
                  value={idType}
                  onChange={(val) => setIdType((val as string) as 'CITIZEN_ID' | 'PASSPORT')}
                  size="sm"
                />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.idNumber')}</label>
                <Input
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  size="sm"
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col" style={{ width: '7rem' }}>
                <label className="form-label">{t('wizard.prefix')}</label>
                <Select
                  options={PREFIX_OPTIONS}
                  value={prefix}
                  onChange={(val) => setPrefix(val as string)}
                  size="sm"
                  clearable
                />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.firstName')}</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} size="sm" className="w-full" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.lastName')}</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} size="sm" className="w-full" />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.dateOfBirth')}</label>
                <InputDatePicker
                  value={parseLocalDate(dateOfBirth)}
                  onChange={(date) => setDateOfBirth(toLocalDateStr(date))}
                  size="sm"
                  endIcon={<Keyboard size={16} />}
                  onEndIconClick={() => setIsTypingDob(t => !t)}
                  locale={i18n.language}
                  calendar="gregorian"
                  typingMode={isTypingDob}
                  onTypingModeChange={setIsTypingDob}
                  typingMask="##/##/####"
                  typingPlaceholder="DD/MM/YYYY"
                  parseTypedDate={(raw) => {
                    if (raw.length !== 8) return null;
                    const day = parseInt(raw.slice(0, 2), 10);
                    const month = parseInt(raw.slice(2, 4), 10);
                    let year = parseInt(raw.slice(4, 8), 10);
                    if (year > 2400) year -= 543;
                    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                    const d = new Date(year, month - 1, day);
                    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                    return d;
                  }}
                />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.tel')}</label>
                <Input value={tel} onChange={(e) => setTel(e.target.value)} size="sm" className="w-full" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('wizard.tel2')}</label>
                <Input value={tel2} onChange={(e) => setTel2(e.target.value)} size="sm" className="w-full" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button color="primary" onClick={handleRegister} disabled={submitting || !idNumber.trim() || !firstName.trim() || !lastName.trim() || !tel.trim()}>
              {submitting ? t('common.saving') : (customerId ? t('wizard.updateCustomer') : t('wizard.registerCustomer'))}
            </Button>
          </div>

          {/* ── Sub-sections (only when customer exists) ── */}
          {customerId && (
            <>
              <div className="border-t border-line" />

              {/* Address: HOME */}
              <ExpandableSection
                title={t('workspace.addressHome')}
                done={!!homeAddress}
                expanded={showAddressHome}
                onToggle={() => setShowAddressHome(!showAddressHome)}
              >
                <AddressFormPostal
                  customerId={customerId}
                  addressType="HOME"
                  existing={homeAddress}
                  onSuccess={() => handleAddressSuccess('HOME')}
                />
              </ExpandableSection>

              {/* Address: WORK */}
              <ExpandableSection
                title={t('workspace.addressWork')}
                done={!!workAddress}
                expanded={showAddressWork}
                onToggle={() => setShowAddressWork(!showAddressWork)}
              >
                <AddressFormPostal
                  customerId={customerId}
                  addressType="WORK"
                  existing={workAddress}
                  onSuccess={() => handleAddressSuccess('WORK')}
                />
              </ExpandableSection>

              {/* Address: SHIPPING */}
              <ExpandableSection
                title={t('workspace.addressShipping')}
                done={!!shippingAddress}
                expanded={showAddressShipping}
                onToggle={() => setShowAddressShipping(!showAddressShipping)}
              >
                <div className="alert alert-info mb-3">
                  <Info size={16} />
                  <div><div className="alert-description">{t('workspace.shippingAddressHint')}</div></div>
                </div>
                <AddressFormPostal
                  customerId={customerId}
                  addressType="SHIPPING"
                  existing={shippingAddress}
                  onSuccess={() => handleAddressSuccess('SHIPPING')}
                />
              </ExpandableSection>

              {/* Contacts */}
              <ExpandableSection
                title={`${t('workspace.contacts')} (${contacts.length})`}
                done={contacts.length > 0}
                expanded={showContacts}
                onToggle={() => setShowContacts(!showContacts)}
              >
                <div className="flex flex-col gap-2">
                  {contacts.map(c => (
                    <ContactRow key={c.id} contact={c} onDeleted={handleContactDeleted} />
                  ))}
                  <ContactAddForm customerId={customerId} onSuccess={handleContactSuccess} />
                </div>
              </ExpandableSection>

              {/* References */}
              <ExpandableSection
                title={`${t('workspace.references')} (${references.length})`}
                done={references.length > 0}
                expanded={showReferences}
                onToggle={() => setShowReferences(!showReferences)}
                warning={references.length === 0 ? t('workspace.refRequired') : undefined}
              >
                <div className="flex flex-col gap-2">
                  {references.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-sm py-1">
                      <span className="font-medium">{r.name} {r.last_name}</span>
                      {r.relation && <Badge size="xs" color="default">{r.relation}</Badge>}
                      {r.tel && <span className="text-subtle tabular-nums">{r.tel}</span>}
                    </div>
                  ))}
                  <ReferenceAddForm customerId={customerId} onSuccess={handleReferenceSuccess} />
                </div>
              </ExpandableSection>
            </>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={handleClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}

// ── Expandable Section ───────────────────────────────────────────────────

function ExpandableSection({ title, done, expanded, onToggle, warning, children }: {
  title: string;
  done: boolean;
  expanded: boolean;
  onToggle: () => void;
  warning?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-surface-hover transition-colors cursor-pointer text-left"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {done ? <CheckCircle size={14} className="text-success" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30 shrink-0" />}
        <span className="flex-1">{title}</span>
        {warning && <span className="text-xs text-warning-fg">{warning}</span>}
      </button>
      {expanded && (
        <div className="px-4 pb-3 border-t border-line pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Result Banner ────────────────────────────────────────────────────────

function ResultBanner({ result, t }: { result: CustomerRegisterResult; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (result.action === 'BLOCK') {
    return (
      <div className="alert alert-danger">
        <ShieldAlert size={18} />
        <div>
          <div className="alert-title">{t('wizard.blacklisted')}</div>
          <div className="alert-description">{result.blacklist_reasons?.[0]?.reason ?? t('wizard.blacklistedDesc')}</div>
        </div>
      </div>
    );
  }

  if (result.action === 'WARNING') {
    return (
      <div className="alert alert-warning">
        <AlertTriangle size={18} />
        <div>
          <div className="alert-title">{t('wizard.customerWarning')}</div>
          <div className="alert-description">
            {t('wizard.overdueContracts', { count: result.overdue_contract_count })}
            {result.active_contract_count > 0 && ` · ${t('wizard.activeContracts', { count: result.active_contract_count })}`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="alert alert-success">
      <CheckCircle size={18} />
      <div>
        <div className="alert-title">{result.is_new ? t('wizard.customerCreated') : t('wizard.customerUpdated')}</div>
      </div>
    </div>
  );
}

// ── Contact Row ──────────────────────────────────────────────────────────

function ContactRow({ contact, onDeleted }: { contact: CustomerContact; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.rpc('fn_customer_contact_delete', { p_id: contact.id });
      onDeleted();
    } catch { /* silently fail */ } finally { setDeleting(false); }
  };

  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="flex items-center gap-2">
        {contact.is_primary && <Star size={12} className="text-warning-fg fill-warning" />}
        <Badge size="xs" color="info">{contact.contact_type}</Badge>
        <span className="tabular-nums">{contact.value}</span>
        {contact.label && <span className="text-subtle text-xs">({contact.label})</span>}
      </div>
      <button className="p-1 rounded hover:bg-surface-hover cursor-pointer text-subtle hover:text-danger" onClick={handleDelete} disabled={deleting}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Contact Add Form ─────────────────────────────────────────────────────

function ContactAddForm({ customerId, onSuccess }: { customerId: number; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [contactType, setContactType] = useState('MOBILE');
  const [value, setValue] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const typeOptions = CONTACT_TYPES.map(ct => ({ value: ct, label: ct }));

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_customer_contact_upsert', {
        p_customer_id: customerId,
        p_contact_type: contactType,
        p_value: value.trim(),
        p_label: null,
        p_is_primary: isPrimary,
        p_note: null,
      });
      setValue('');
      setIsPrimary(false);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 p-3 rounded-md border border-dashed border-line mt-1">
      {error && <div className="alert alert-danger text-xs"><XCircle size={14} /><span>{error}</span></div>}
      <div className="flex gap-3">
        <div className="flex flex-col" style={{ width: '8rem' }}>
          <Select size="sm" options={typeOptions} value={contactType} onChange={v => setContactType(v as string)} showChevron searchable={false} />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <Input size="sm" value={value} onChange={e => setValue(e.target.value)} className="w-full" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
          {t('customer.contactPrimary')}
        </label>
        <Button color="primary" size="sm" onClick={handleSave} disabled={saving || !value.trim()} startIcon={<Plus size={12} />}>
          {t('common.add')}
        </Button>
      </div>
    </div>
  );
}

// ── Reference Add Form ───────────────────────────────────────────────────

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
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_customer_reference_add', {
        p_customer_id: customerId,
        p_name: name.trim(),
        p_last_name: lastName.trim() || null,
        p_tel: tel.trim() || null,
        p_relation: relation.trim() || null,
        p_facebook: null,
        p_line_id: null,
      });
      setName('');
      setLastName('');
      setTel('');
      setRelation('');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 p-3 rounded-md border border-dashed border-line mt-1">
      {error && <div className="alert alert-danger text-xs"><XCircle size={14} /><span>{error}</span></div>}
      <div className="flex gap-3">
        <div className="flex flex-col flex-1">
          <Input size="sm" value={name} onChange={e => setName(e.target.value)} className="w-full" placeholder={t('customer.refName')} />
        </div>
        <div className="flex flex-col flex-1">
          <Input size="sm" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full" placeholder={t('customer.refLastName')} />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex flex-col flex-1">
          <Input size="sm" value={tel} onChange={e => setTel(e.target.value)} className="w-full" placeholder={t('customer.refTel')} />
        </div>
        <div className="flex flex-col flex-1">
          <Input size="sm" value={relation} onChange={e => setRelation(e.target.value)} className="w-full" placeholder={t('customer.refRelation')} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button color="primary" size="sm" onClick={handleSave} disabled={saving || !name.trim()} startIcon={<Plus size={12} />}>
          {t('common.add')}
        </Button>
      </div>
    </div>
  );
}
