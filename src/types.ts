export interface CustomizationGroup {
  id: string;
  name: string;
  type?: string;
  options: {
    id: string;
    name: string;
    price: number;
  }[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: "Coffee" | "Tea" | "Food" | "Dessert" | "Wine";
  image: string;
  customizations: CustomizationGroup[];
  tags?: string[];
  isAvailable?: boolean;
  is_active?: boolean;
  is_available?: boolean;
  badge?: string;
}

/** Shape of a wine document returned by GET /api/wines. */
export interface WineItem {
  id: string;
  name: string;
  type?: string;
  region?: string;
  vintage?: string;
  price_bottle?: number;
  price_glass?: number;
  stock_status?: string;
  tasting_notes?: string;
  image_url?: string;
}

export interface CartItem extends MenuItem {
  cartId: string;
  quantity: number;
  selectedOptions?: Record<string, string | string[]>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content?: string;
  text?: string;
  timestamp?: string | Date;
  items?: MenuItem[];
  recommendedItems?: MenuItem[];
}

export interface Order {
  id: string;
  userId: string;
  items: CartItem[];
  total: number;
  status: "pending" | "preparing" | "ready" | "completed" | "cancelled";
  createdAt?: string;
  date?: string;
}

export interface AIInsightRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
}

export interface AIInsights {
  peak_hours_analysis: string;
  revenue_prediction: string;
  recommendations: AIInsightRecommendation[];
  inventory_alerts: string[];
}

export interface UserProfile {
  id?: string;
  name: string;
  email: string;
  role?: "admin" | "customer";
  preferences?: string[];
  avatar?: string;
  totalOrders?: number;
  loyaltyPoints?: number;
  memberSince?: string;
}

export const MENU_ITEMS: MenuItem[] = [
  {
    id: "1",
    name: "Salted Caramel Mocha",
    description:
      "Espresso, steamed milk, mocha sauce, and toffee nut syrup, topped with sweetened whipped cream, caramel drizzle and a blend of turbinado sugar and sea salt.",
    price: 5.5,
    category: "Coffee",
    image:
      "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=800&q=80",
    customizations: [
      {
        id: "milk",
        name: "Milk Type",
        options: [
          { id: "whole", name: "Whole Milk", price: 0 },
          { id: "oat", name: "Oat Milk", price: 0.8 },
          { id: "almond", name: "Almond Milk", price: 0.8 },
        ],
      },
    ],
  },
];

export const WINE_ITEMS: MenuItem[] = [
  {
    id: "w1",
    name: "Cabernet Sauvignon",
    description:
      "Rich, full-bodied red wine with notes of dark cherry and oak.",
    price: 12.0,
    category: "Wine",
    image:
      "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=800&q=80",
    customizations: [],
  },
];
