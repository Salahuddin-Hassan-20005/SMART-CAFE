import React, { createContext, useContext, useState, ReactNode } from 'react';
import { CartItem, MenuItem } from './types';

interface CartContextType {
  items: CartItem[];
  addItem: (item: MenuItem, selectedOptions?: Record<string, string | string[]>) => void;
  removeItem: (cartId: string) => void;
  updateQuantity: (cartId: string, delta: number) => void;
  clearCart: () => void;
  subtotal: number;
  getItemPrice: (item: MenuItem, selectedOptions?: Record<string, string | string[]>) => number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const getItemPrice = (item: MenuItem, selectedOptions?: Record<string, string | string[]>) => {
    let total = item.price;
    if (!selectedOptions || !item.customizations) return total;

    // Check if customizations is a flat array (new schema) or nested groups (old schema)
    const isFlatArray = item.customizations.length > 0 && 'name' in item.customizations[0];

    if (isFlatArray) {
      // Handle flat array schema: [{ name, extra_price }]
      Object.entries(selectedOptions).forEach(([optionId, isSelected]) => {
        if (String(isSelected) === 'true') {
          const customization = item.customizations?.find((c: any) => {
            const idx = parseInt(optionId.replace('custom_', ''));
            return item.customizations?.[idx] === c;
          });
          if (customization && (customization as any).extra_price) {
            total += (customization as any).extra_price;
          }
        }
      });
    } else {
      // Handle nested group schema (legacy)
      Object.entries(selectedOptions).forEach(([groupId, optionIds]) => {
        const group = item.customizations?.find(g => g.id === groupId);
        if (!group) return;

        const ids = Array.isArray(optionIds) ? optionIds : [optionIds];
        ids.forEach(id => {
          const option = group.options.find(o => o.id === id);
          if (option?.price) total += option.price;
        });
      });
    }
    return total;
  };

  const addItem = (item: MenuItem, selectedOptions?: Record<string, string | string[]>) => {
    const cartId = `${item.id}-${JSON.stringify(selectedOptions || {})}`;
    
    setItems(prev => {
      const existing = prev.find(i => i.cartId === cartId);
      if (existing) {
        return prev.map(i => i.cartId === cartId ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, cartId, quantity: 1, selectedOptions }];
    });
  };

  const removeItem = (cartId: string) => {
    setItems(prev => prev.filter(i => i.cartId !== cartId));
  };

  const updateQuantity = (cartId: string, delta: number) => {
    setItems(prev => prev.map(i => {
      if (i.cartId === cartId) {
        const newQty = Math.max(1, i.quantity + delta);
        return { ...i, quantity: newQty };
      }
      return i;
    }));
  };

  const clearCart = () => setItems([]);

  const subtotal = items.reduce((acc, item) => {
    const price = getItemPrice(item, item.selectedOptions);
    return acc + price * item.quantity;
  }, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, subtotal, getItemPrice }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within a CartProvider');
  return context;
}
