// Bundled app catalog mirror — names/categories/base prices as shipped in the
// customer app (1_Customer_App/lib/core/data/food_mela_data.dart).
// Used so admin picks items BY NAME; the doc ID is the itemId (never typed).
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  basePrice: number;
  unit?: string;
  unitOptions?: string[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  cooked_food: 'Cooked Food',
  non_veg: 'Non-Veg',
  fast_food: 'Fast Food',
  beverages: 'Drinks & Beverages',
  sweets: 'Sweets',
  snacks: 'Snacks',
  vegetables: 'Vegetables',
  fruits: 'Fruits',
  grocery: 'Grocery & Staples',
  dals_pulses: 'Dals & Pulses',
  chaat: 'Chaat & Street Food',
  dairy: 'Dairy',
  eggs_meat: 'Eggs & Meat',
  breakfast: 'Breakfast',
  momos: 'Momos & Dimsum',
  fashion: 'Fashion & Dress',
  furniture: 'Furniture',
};

export const CATALOG: CatalogItem[] = [
  { id: 'dal1', name: 'Odisha Bhaja Moong Dal (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 140, unit: '1 kg' },
  { id: 'dal2', name: 'Yellow Moong Dal (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 130, unit: '1 kg' },
  { id: 'dal3', name: 'Whole Green Moong (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 120, unit: '1 kg' },
  { id: 'dal4', name: 'High Protein Toor Dal (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 165, unit: '1 kg' },
  { id: 'dal5', name: 'Pure White Urad Dal (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 135, unit: '1 kg' },
  { id: 'dal6', name: 'Split Masoor Dal (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 110, unit: '1 kg' },
  { id: 'dal7', name: 'Desi Chana Dal (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 95, unit: '1 kg' },
  { id: 'dal8', name: 'Black Urad Whole (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 125, unit: '1 kg' },
  { id: 'dal9', name: 'Unpolished Kabuli Chana (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 125, unit: '1 kg' },
  { id: 'dal10', name: 'Rajma Jammu Special (1kg)', category: 'dals_pulses', categoryLabel: 'Dals & Pulses', basePrice: 135, unit: '1 kg' },
  { id: 'rc1', name: 'Premium Basmati Rice (1kg)', category: 'grocery', categoryLabel: 'Grocery & Staples', basePrice: 145, unit: '1 kg' },
  { id: 'rc2', name: 'Govind Bhog Arwa Rice (1kg)', category: 'grocery', categoryLabel: 'Grocery & Staples', basePrice: 95, unit: '1 kg' },
  { id: 'rc3', name: 'Parboiled Usuna Rice (1kg)', category: 'grocery', categoryLabel: 'Grocery & Staples', basePrice: 52, unit: '1 kg' },
  { id: 'gh1', name: 'Pure Desi Cow Ghee (500ml)', category: 'grocery', categoryLabel: 'Grocery & Staples', basePrice: 380, unit: '500 ml' },
  { id: 'gh2', name: 'A2 Bilona Desi Ghee (500ml)', category: 'grocery', categoryLabel: 'Grocery & Staples', basePrice: 540, unit: '500 ml' },
  { id: 'cht1', name: 'Dahibara Aloo Dum Chaat', category: 'chaat', categoryLabel: 'Chaat & Street Food', basePrice: 60, unit: '1 Plate' },
  { id: 'cht2', name: 'Crispy Papdi Chaat', category: 'chaat', categoryLabel: 'Chaat & Street Food', basePrice: 50, unit: '1 Plate' },
  { id: 'cht3', name: 'Samosa Matar Chaat', category: 'chaat', categoryLabel: 'Chaat & Street Food', basePrice: 45, unit: '1 Plate' },
  { id: 'cf1', name: 'Chicken Biryani', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 220, unit: '1 Full Plate' },
  { id: 'cf2', name: 'Paneer Butter Masala', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 180, unit: '1 Portion' },
  { id: 'cf3', name: 'Dal Makhani', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 150, unit: '1 Portion' },
  { id: 'vg1', name: 'Fresh Tomato', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 35, unit: '1 kg' },
  { id: 'vg2', name: 'Potato', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 28, unit: '1 kg' },
  { id: 'vg3', name: 'Onion', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 35, unit: '1 kg' },
];
