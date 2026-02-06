export interface ImeiSuggestion {
  imei: string;
  device: string;
}

// Mock IMEI data - valid IMEIs that pass Luhn check
const MOCK_IMEI_DATA: ImeiSuggestion[] = [
  { imei: '353456789012348', device: 'iPhone 15 Pro' },
  { imei: '490154203237518', device: 'iPhone 14' },
  { imei: '356938035643809', device: 'iPhone 13' },
  { imei: '353456789012355', device: 'iPhone 12' },
  { imei: '352099001761481', device: 'Samsung Galaxy' },
  { imei: '861536030196001', device: 'Google Pixel' },
];

export function mockSearchImei(query: string): Promise<ImeiSuggestion[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        MOCK_IMEI_DATA.filter(
          (item) =>
            item.imei.includes(query) ||
            item.device.toLowerCase().includes(query.toLowerCase())
        )
      );
    }, 500);
  });
}
