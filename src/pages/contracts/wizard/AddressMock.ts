// ⚠️ MOCK DATA — replace with real API (v_provinces/v_districts/v_subdistricts) when available

export interface Province {
  id: number;
  name_th: string;
  name_en: string;
}

export interface District {
  id: number;
  province_id: number;
  name_th: string;
  name_en: string;
}

export interface Subdistrict {
  id: number;
  district_id: number;
  name_th: string;
  name_en: string;
  zip_code: string;
}

export const MOCK_PROVINCES: Province[] = [
  { id: 1, name_th: 'กรุงเทพมหานคร', name_en: 'Bangkok' },
  { id: 2, name_th: 'นนทบุรี', name_en: 'Nonthaburi' },
  { id: 3, name_th: 'ชลบุรี', name_en: 'Chonburi' },
  { id: 4, name_th: 'เชียงใหม่', name_en: 'Chiang Mai' },
  { id: 5, name_th: 'ขอนแก่น', name_en: 'Khon Kaen' },
];

export const MOCK_DISTRICTS: District[] = [
  // Bangkok
  { id: 101, province_id: 1, name_th: 'พระนคร', name_en: 'Phra Nakhon' },
  { id: 102, province_id: 1, name_th: 'ดุสิต', name_en: 'Dusit' },
  { id: 103, province_id: 1, name_th: 'บางรัก', name_en: 'Bang Rak' },
  // Nonthaburi
  { id: 201, province_id: 2, name_th: 'เมืองนนทบุรี', name_en: 'Mueang Nonthaburi' },
  { id: 202, province_id: 2, name_th: 'บางบัวทอง', name_en: 'Bang Bua Thong' },
  // Chonburi
  { id: 301, province_id: 3, name_th: 'เมืองชลบุรี', name_en: 'Mueang Chonburi' },
  { id: 302, province_id: 3, name_th: 'บางละมุง', name_en: 'Bang Lamung' },
  // Chiang Mai
  { id: 401, province_id: 4, name_th: 'เมืองเชียงใหม่', name_en: 'Mueang Chiang Mai' },
  { id: 402, province_id: 4, name_th: 'สันทราย', name_en: 'San Sai' },
  // Khon Kaen
  { id: 501, province_id: 5, name_th: 'เมืองขอนแก่น', name_en: 'Mueang Khon Kaen' },
  { id: 502, province_id: 5, name_th: 'บ้านฝาง', name_en: 'Ban Fang' },
];

export const MOCK_SUBDISTRICTS: Subdistrict[] = [
  // Phra Nakhon
  { id: 10101, district_id: 101, name_th: 'พระบรมมหาราชวัง', name_en: 'Phra Borom Maha Ratchawang', zip_code: '10200' },
  { id: 10102, district_id: 101, name_th: 'วังบูรพาภิรมย์', name_en: 'Wang Burapha Phirom', zip_code: '10200' },
  // Dusit
  { id: 10201, district_id: 102, name_th: 'ดุสิต', name_en: 'Dusit', zip_code: '10300' },
  { id: 10202, district_id: 102, name_th: 'วชิรพยาบาล', name_en: 'Wachiraphayaban', zip_code: '10300' },
  // Bang Rak
  { id: 10301, district_id: 103, name_th: 'มหาพฤฒาราม', name_en: 'Maha Phruettharam', zip_code: '10500' },
  // Mueang Nonthaburi
  { id: 20101, district_id: 201, name_th: 'สวนใหญ่', name_en: 'Suan Yai', zip_code: '11000' },
  { id: 20102, district_id: 201, name_th: 'ตลาดขวัญ', name_en: 'Talat Khwan', zip_code: '11000' },
  // Bang Bua Thong
  { id: 20201, district_id: 202, name_th: 'โสนลอย', name_en: 'Sano Loi', zip_code: '11110' },
  // Mueang Chonburi
  { id: 30101, district_id: 301, name_th: 'บางปลาสร้อย', name_en: 'Bang Pla Soi', zip_code: '20000' },
  // Bang Lamung
  { id: 30201, district_id: 302, name_th: 'บางละมุง', name_en: 'Bang Lamung', zip_code: '20150' },
  // Mueang Chiang Mai
  { id: 40101, district_id: 401, name_th: 'ศรีภูมิ', name_en: 'Si Phum', zip_code: '50200' },
  // San Sai
  { id: 40201, district_id: 402, name_th: 'สันทรายหลวง', name_en: 'San Sai Luang', zip_code: '50210' },
  // Mueang Khon Kaen
  { id: 50101, district_id: 501, name_th: 'ในเมือง', name_en: 'Nai Mueang', zip_code: '40000' },
  // Ban Fang
  { id: 50201, district_id: 502, name_th: 'บ้านฝาง', name_en: 'Ban Fang', zip_code: '40270' },
];

export function getDistrictsByProvince(provinceId: number): District[] {
  return MOCK_DISTRICTS.filter(d => d.province_id === provinceId);
}

export function getSubdistrictsByDistrict(districtId: number): Subdistrict[] {
  return MOCK_SUBDISTRICTS.filter(s => s.district_id === districtId);
}
