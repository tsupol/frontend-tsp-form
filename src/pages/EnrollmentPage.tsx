import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Button, type Option } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Search, Clock, RefreshCw } from 'lucide-react';
import { mockSearchContracts, mockIssueEnrollment, type ContractInfo, type EnrollmentResult } from '../mocks/contractSearch';

const ENROLL_BASE_URL = 'https://frontend-tsp-form.ecap.space/enroll';

export function EnrollmentPage() {
  const { t } = useTranslation();

  // Contract selection state
  const [contractId, setContractId] = useState<string | null>(null);
  const [selectedContract, setSelectedContract] = useState<ContractInfo | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Enrollment state
  const [enrollment, setEnrollment] = useState<EnrollmentResult | null>(null);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Load default options on mount
  useEffect(() => {
    setSearchLoading(true);
    mockSearchContracts('').then((contracts) => {
      setOptions(contractsToOptions(contracts));
      setSearchLoading(false);
    });
  }, []);

  // Countdown timer for enrollment expiry
  useEffect(() => {
    if (!enrollment) return;

    const updateTimer = () => {
      const expires = new Date(enrollment.expires_at).getTime();
      const now = Date.now();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeRemaining(t('enrollment.expired'));
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [enrollment, t]);

  const contractsToOptions = (contracts: ContractInfo[]): Option[] => {
    return contracts.map((c) => ({
      value: String(c.product_sale_id),
      label: `${c.contract_code} - ${c.customer_name}`,
    }));
  };

  const handleSearchChange = useCallback((searchTerm: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setSearchLoading(true);
    debounceRef.current = setTimeout(() => {
      mockSearchContracts(searchTerm).then((contracts) => {
        setOptions(contractsToOptions(contracts));
        setSearchLoading(false);
      });
    }, 300);
  }, []);

  const handleContractChange = useCallback((value: string | string[] | null) => {
    const id = value as string | null;
    setContractId(id);
    setEnrollment(null);

    if (id) {
      mockSearchContracts('').then((contracts) => {
        const contract = contracts.find((c) => c.product_sale_id === Number(id));
        setSelectedContract(contract || null);
      });
    } else {
      setSelectedContract(null);
    }
  }, []);

  const handleGenerateEnrollment = async () => {
    if (!selectedContract) return;

    setEnrollLoading(true);
    try {
      const result = await mockIssueEnrollment(selectedContract.product_sale_id);
      setEnrollment(result);
    } finally {
      setEnrollLoading(false);
    }
  };

  const handleRefresh = () => {
    handleGenerateEnrollment();
  };

  return (
    <div className="page-content p-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-bold mb-6">{t('enrollment.title')}</h1>

        {/* Contract Search */}
        <div className="border border-line bg-surface p-6 rounded-lg mb-6">
          <h2 className="font-semibold mb-4">{t('enrollment.selectContract')}</h2>
          <Select
            id="contract-select"
            options={options}
            value={contractId}
            onChange={handleContractChange}
            onSearchChange={handleSearchChange}
            loading={searchLoading}
            placeholder={t('enrollment.searchPlaceholder')}
            startIcon={<Search size={16} />}
            clearable
            showChevron={false}
          />
          <div className="text-xs text-control-label mt-2">
            {t('enrollment.searchHint')}
          </div>
        </div>

        {/* Contract Details */}
        {selectedContract && (
          <div className="border border-line bg-surface-shallow p-4 rounded-lg mb-6 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-control-label">{t('enrollment.contractCode')}:</span>
                <span className="font-mono">{selectedContract.contract_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-control-label">{t('enrollment.customer')}:</span>
                <span>{selectedContract.customer_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-control-label">{t('device.imei')}:</span>
                <span className="font-mono">{selectedContract.imei}</span>
              </div>
              {selectedContract.serial_number && (
                <div className="flex justify-between">
                  <span className="text-control-label">{t('device.serial')}:</span>
                  <span className="font-mono">{selectedContract.serial_number}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Generate Button */}
        {selectedContract && !enrollment && (
          <Button
            type="button"
            variant="outline"
            className="w-full mb-6"
            onClick={handleGenerateEnrollment}
            disabled={enrollLoading}
          >
            {enrollLoading ? t('common.loading') : t('enrollment.generate')}
          </Button>
        )}

        {/* QR Code / Enrollment Result */}
        {enrollment && (
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <h2 className="font-semibold mb-4">{t('enrollment.scanTitle')}</h2>

            {/* QR Code */}
            <div className="inline-flex items-center justify-center w-48 h-48 bg-white border-2 border-line rounded-lg mb-4 p-2">
              <QRCodeSVG
                value={`${ENROLL_BASE_URL}?id=${enrollment.enrollment_id}`}
                size={176}
                level="M"
              />
            </div>

            <p className="text-sm text-control-label mb-4">
              {t('enrollment.scanDescription')}
            </p>

            {/* Timer */}
            <div className="flex items-center justify-center gap-2 text-sm mb-4">
              <Clock size={16} className="text-control-label" />
              <span className="text-control-label">{t('enrollment.expiresIn')}:</span>
              <span className="font-mono font-semibold">{timeRemaining}</span>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleRefresh}
                disabled={enrollLoading}
              >
                <RefreshCw size={16} className="mr-2" />
                {t('enrollment.refresh')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
