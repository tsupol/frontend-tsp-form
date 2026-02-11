export interface ContractInfo {
  product_sale_id: number;
  contract_code: string;
  imei: string;
  serial_number: string | null;
  customer_name: string;
}

const MOCK_CONTRACTS: ContractInfo[] = [
  { product_sale_id: 1, contract_code: '20251223ST3TPA20003', imei: '351212583554056', serial_number: null, customer_name: 'John Doe' },
  { product_sale_id: 2, contract_code: '20250804ST3TPA30003', imei: '351109574833483', serial_number: null, customer_name: 'Jane Smith' },
  { product_sale_id: 3, contract_code: '20250907ST3TPA10009', imei: '357200607486284', serial_number: 'C39XJZZ1GRY3', customer_name: 'Bob Wilson' },
  { product_sale_id: 4, contract_code: '20250708ST3TPA20003', imei: '354090444069846', serial_number: null, customer_name: 'Alice Brown' },
  { product_sale_id: 5, contract_code: '20250829ST3TPA10013', imei: '357214983883378', serial_number: 'DNPXK0Z1HG7F', customer_name: 'Charlie Davis' },
];

export function mockSearchContracts(query: string): Promise<ContractInfo[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (query.length < 3) {
        resolve(MOCK_CONTRACTS.slice(0, 4));
        return;
      }
      resolve(
        MOCK_CONTRACTS.filter(
          (c) =>
            c.contract_code.toLowerCase().includes(query.toLowerCase()) ||
            c.imei.includes(query) ||
            c.customer_name.toLowerCase().includes(query.toLowerCase())
        )
      );
    }, 500);
  });
}

export function mockGetContractById(id: number): Promise<ContractInfo | undefined> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(MOCK_CONTRACTS.find((c) => c.product_sale_id === id));
    }, 300);
  });
}

export interface EnrollmentResult {
  enrollment_id: string;
  expires_at: string;
  provider_profile_id: number;
}

export function mockIssueEnrollment(_productSaleId: number): Promise<EnrollmentResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        enrollment_id: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        provider_profile_id: 1,
      });
    }, 800);
  });
}
