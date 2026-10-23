import React, { useEffect, useState } from 'react';
import { Plus, Search, Sparkles, TrendingUp, Clock, AlertCircle, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MenuItem, Order } from '../types';
import { collection, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { toast } from 'sonner';
import { generateAdminInsights } from '../lib/ai';

interface AuditLog {
  id: string;
  action: string;
  item: string;
  user: string;
  createdAt: string;
}

export function AdminDashboardScreen() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'available' | 'out-of-stock'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [insights, setInsights] = useState<{ sentiment: string, peakTime: string, insight: string } | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  
  // New Item Form State
  const [newItem, setNewItem] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Coffee',
    image: 'https://picsum.photos/seed/newitem/400/400'
  });

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'menu_items'), (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as MenuItem[];
      setItems(fetchedItems);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'orders'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedOrders = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Order[];
      setOrders(fetchedOrders);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (items.length > 0 && orders.length > 0 && !insights && !loadingInsights) {
      setLoadingInsights(true);
      generateAdminInsights(orders, items).then(data => {
        setInsights(data);
        setLoadingInsights(false);
      }).catch(err => {
        console.error("Failed to generate insights", err);
        setLoadingInsights(false);
      });
    }
  }, [items, orders, insights, loadingInsights]);

  useEffect(() => {
    const q = query(collection(db, 'auditLogs'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AuditLog[];
      
      logs.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      setAuditLogs(logs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'auditLogs');
    });

    return () => unsubscribe();
  }, []);

  const logAction = async (action: string, itemName: string) => {
    try {
      await addDoc(collection(db, 'auditLogs'), {
        action,
        item: itemName,
        user: auth.currentUser?.email || 'Admin',
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to log action', error);
    }
  };

  const toggleAvailability = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    const previousItems = [...items];
    setItems(prev => prev.map(i => 
      i.id === id ? { ...i, is_available: !i.is_available } : i
    ));

    try {
      await updateDoc(doc(db, 'menuItems', id), {
        is_available: !item.is_available,
        updatedAt: serverTimestamp()
      });
      toast.success(`Marked as ${!item.is_available ? 'Available' : 'Sold Out'}`);
      logAction(!item.is_available ? 'Marked Available' : 'Marked Sold Out', item.name);
    } catch (error) {
      setItems(previousItems);
      toast.error('Failed to update availability');
      handleFirestoreError(error, OperationType.UPDATE, `menuItems/${id}`);
    }
  };

  const softDelete = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    try {
      await updateDoc(doc(db, 'menuItems', id), {
        is_active: false,
        updatedAt: serverTimestamp()
      });
      toast.success('Item removed from menu');
      logAction('Removed Item', item.name);
    } catch (error) {
      toast.error('Failed to remove item');
      handleFirestoreError(error, OperationType.UPDATE, `menuItems/${id}`);
    }
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         item.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const isAvailable = item.is_available !== false;
    if (activeFilter === 'available') return matchesSearch && isAvailable;
    if (activeFilter === 'out-of-stock') return matchesSearch && !isAvailable;
    return matchesSearch;
  });

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'menu_items'), {
        name: newItem.name,
        description: newItem.description,
        price: parseFloat(newItem.price),
        category: newItem.category,
        image: newItem.image,
        customizations: [],
        is_active: true,
        is_available: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setShowAddModal(false);
      logAction('Added Item', newItem.name);
      setNewItem({ name: '', description: '', price: '', category: 'Coffee', image: 'https://picsum.photos/seed/newitem/400/400' });
      toast.success('Item added successfully');
    } catch (error) {
      toast.error('Failed to add item');
      handleFirestoreError(error, OperationType.CREATE, 'menuItems');
    }
  };

  return (
    <main className="lg:ml-64 p-6 lg:p-10 bg-surface-container-lowest min-h-screen pt-24 lg:pt-10">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-6 mb-12">
        <div>
          <span className="text-[0.75rem] font-label tracking-[0.2em] text-stone-400 uppercase mb-2 block">Overview</span>
          <h1 className="text-4xl lg:text-5xl font-headline text-primary">Menu Management</h1>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl py-3 pl-12 pr-6 w-full md:w-80 font-body text-sm outline-none focus:border-primary transition-colors" 
              placeholder="Search dishes..." 
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
          </div>
          <button 
            onClick={() => setShowAddModal(true)}
            className="bg-primary text-white px-8 py-3 rounded-xl font-bold uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg shadow-primary/10 hover:scale-[1.02] transition-transform"
          >
            <Plus size={20} />
            Add New Item
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Main Content */}
        <div className="lg:col-span-8 space-y-10">
          <div className="bg-white rounded-3xl border border-stone-200/30 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
              <div className="flex gap-8">
                <button 
                  onClick={() => setActiveFilter('all')}
                  className={`font-bold pb-1 text-sm uppercase tracking-widest transition-colors ${activeFilter === 'all' ? 'text-primary border-b-2 border-primary' : 'text-stone-400 hover:text-primary'}`}
                >
                  All Items
                </button>
                <button 
                  onClick={() => setActiveFilter('available')}
                  className={`font-bold pb-1 text-sm uppercase tracking-widest transition-colors ${activeFilter === 'available' ? 'text-primary border-b-2 border-primary' : 'text-stone-400 hover:text-primary'}`}
                >
                  Available
                </button>
                <button 
                  onClick={() => setActiveFilter('out-of-stock')}
                  className={`font-bold pb-1 text-sm uppercase tracking-widest transition-colors ${activeFilter === 'out-of-stock' ? 'text-primary border-b-2 border-primary' : 'text-stone-400 hover:text-primary'}`}
                >
                  Out of Stock
                </button>
              </div>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[800px] lg:min-w-0">
                <thead>
                  <tr className="text-left border-b border-stone-100">
                    <th className="px-8 py-5 font-label text-[10px] uppercase tracking-widest text-stone-400">Item Details</th>
                    <th className="px-8 py-5 font-label text-[10px] uppercase tracking-widest text-stone-400">Category</th>
                    <th className="px-8 py-5 font-label text-[10px] uppercase tracking-widest text-stone-400">Price</th>
                    <th className="px-8 py-5 font-label text-[10px] uppercase tracking-widest text-stone-400 text-right">Status & Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {filteredItems.map(item => (
                    <tr key={item.id} className="hover:bg-stone-50/50 transition-colors group">
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          <img src={item.image} className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
                          <div>
                            <p className="font-headline text-primary font-bold">{item.name}</p>
                            <p className="text-xs text-stone-400 truncate max-w-[200px]">{item.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className="text-xs font-label uppercase tracking-widest text-stone-500 bg-stone-100 px-3 py-1 rounded-full">{item.category}</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-headline text-primary">${item.price.toFixed(2)}</span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-6">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${item.is_available !== false ? 'bg-tertiary' : 'bg-error'}`}></div>
                            <span className={`text-xs ${item.is_available !== false ? 'text-primary' : 'text-error font-bold'}`}>
                              {item.is_available !== false ? 'Available' : 'Out of Stock'}
                            </span>
                          </div>
                          <button 
                            onClick={() => toggleAvailability(item.id)}
                            className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
                              item.is_available !== false 
                              ? 'bg-stone-100 text-stone-600 hover:bg-stone-200' 
                              : 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/10'
                            }`}
                          >
                            {item.is_available !== false ? 'Mark Out of Stock' : 'Mark Available'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar Insights */}
        <div className="lg:col-span-4 space-y-10">
          <section className="bg-primary text-white rounded-3xl p-8 relative overflow-hidden shadow-2xl shadow-primary/20">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-bl-[4rem]"></div>
            <div className="flex items-center gap-3 mb-6 relative z-10">
              <Sparkles className="text-secondary-container" size={24} />
              <h2 className="text-2xl font-headline italic">Concierge Insights</h2>
            </div>
            <div className="space-y-6 relative z-10">
              {loadingInsights ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="animate-spin text-white/50" size={32} />
                </div>
              ) : insights ? (
                <>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-sm text-white/80 leading-relaxed italic">
                      "{insights.insight}"
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 p-4 rounded-2xl">
                      <TrendingUp className="text-secondary-container mb-2" size={20} />
                      <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Sentiment</p>
                      <p className="text-xl font-headline">{insights.sentiment}</p>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl">
                      <Clock className="text-secondary-container mb-2" size={20} />
                      <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Peak Time</p>
                      <p className="text-xl font-headline">{insights.peakTime}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-sm text-white/80 leading-relaxed italic">
                    Not enough data to generate insights yet.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-3xl p-8 border border-stone-200/30 shadow-sm">
            <h2 className="text-xl font-headline text-primary mb-6 italic">Recent Menu Edits</h2>
            <div className="space-y-6">
              {auditLogs.slice(0, 3).map((edit, i) => (
                <div key={i} className="flex gap-4 items-start">
                  <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center shrink-0">
                    <AlertCircle size={14} className="text-stone-400" />
                  </div>
                  <div>
                    <p className="text-sm text-primary font-bold">{edit.action}: <span className="font-normal text-stone-500">{edit.item}</span></p>
                    <p className="text-[10px] uppercase tracking-widest text-stone-400 mt-1">
                      {new Date(edit.createdAt).toLocaleDateString()} {new Date(edit.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} • {edit.user}
                    </p>
                  </div>
                </div>
              ))}
              {auditLogs.length === 0 && (
                <p className="text-sm text-stone-400 italic">No recent edits.</p>
              )}
            </div>
            <button 
              onClick={() => setShowAuditLog(true)}
              className="w-full mt-8 py-3 text-xs font-label uppercase tracking-widest font-bold text-stone-400 hover:text-primary transition-colors border-t border-stone-50 pt-6"
            >
              View Audit Log
            </button>
          </section>
        </div>
      </div>

      {/* Add Item Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-primary/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] p-10 shadow-2xl"
            >
              <button 
                onClick={() => setShowAddModal(false)}
                className="absolute top-8 right-8 p-2 hover:bg-stone-50 rounded-full transition-colors"
              >
                <X size={20} className="text-stone-400" />
              </button>
              
              <h2 className="text-3xl font-headline text-primary mb-8 italic">Add New Food Item</h2>
              
              <form onSubmit={handleAddItem} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-label font-bold tracking-widest uppercase text-stone-400">Item Name</label>
                  <input 
                    required
                    value={newItem.name}
                    onChange={e => setNewItem({...newItem, name: e.target.value})}
                    className="w-full bg-stone-50 border-b border-stone-200 py-3 px-4 font-body text-primary outline-none focus:border-primary transition-colors"
                    placeholder="e.g. Truffle Omelette"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] font-label font-bold tracking-widest uppercase text-stone-400">Description</label>
                  <textarea 
                    required
                    value={newItem.description}
                    onChange={e => setNewItem({...newItem, description: e.target.value})}
                    className="w-full bg-stone-50 border-b border-stone-200 py-3 px-4 font-body text-primary outline-none focus:border-primary transition-colors h-24 resize-none"
                    placeholder="Describe the dish..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-label font-bold tracking-widest uppercase text-stone-400">Price ($)</label>
                    <input 
                      required
                      type="number"
                      step="0.01"
                      value={newItem.price}
                      onChange={e => setNewItem({...newItem, price: e.target.value})}
                      className="w-full bg-stone-50 border-b border-stone-200 py-3 px-4 font-body text-primary outline-none focus:border-primary transition-colors"
                      placeholder="12.50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-label font-bold tracking-widest uppercase text-stone-400">Category</label>
                    <select 
                      value={newItem.category}
                      onChange={e => setNewItem({...newItem, category: e.target.value})}
                      className="w-full bg-stone-50 border-b border-stone-200 py-3 px-4 font-body text-primary outline-none focus:border-primary transition-colors"
                    >
                      <option>Coffee</option>
                      <option>Tea</option>
                      <option>Food</option>
                      <option>Dessert</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-label font-bold tracking-widest uppercase text-stone-400">Image URL</label>
                  <div className="flex gap-4">
                    <input 
                      required
                      value={newItem.image}
                      onChange={e => setNewItem({...newItem, image: e.target.value})}
                      className="flex-grow bg-stone-50 border-b border-stone-200 py-3 px-4 font-body text-primary outline-none focus:border-primary transition-colors"
                      placeholder="https://..."
                    />
                    <div className="w-12 h-12 rounded-lg bg-stone-100 flex items-center justify-center overflow-hidden shrink-0">
                      {newItem.image ? <img src={newItem.image} className="w-full h-full object-cover" /> : <ImageIcon className="text-stone-300" size={20} />}
                    </div>
                  </div>
                </div>

                <button className="w-full bg-primary text-white py-5 rounded-2xl font-bold uppercase tracking-widest shadow-xl shadow-primary/20 mt-4 hover:scale-[1.01] active:scale-95 transition-all">
                  Publish to Menu
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Audit Log Modal */}
      <AnimatePresence>
        {showAuditLog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuditLog(false)}
              className="absolute inset-0 bg-primary/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] p-10 shadow-2xl"
            >
              <button 
                onClick={() => setShowAuditLog(false)}
                className="absolute top-8 right-8 p-2 hover:bg-stone-50 rounded-full transition-colors"
              >
                <X size={20} className="text-stone-400" />
              </button>
              
              <h2 className="text-3xl font-headline text-primary mb-8 italic">Audit Logs</h2>
              
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-4 custom-scrollbar">
                {auditLogs.map((log, i) => (
                  <div key={i} className="flex justify-between items-center p-4 bg-stone-50 rounded-2xl border border-stone-100">
                    <div>
                      <p className="text-sm text-primary font-bold">{log.action}</p>
                      <p className="text-xs text-stone-500">{log.item}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-widest text-stone-400">
                        {new Date(log.createdAt).toLocaleDateString()} {new Date(log.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </p>
                      <p className="text-xs font-bold text-primary">{log.user}</p>
                    </div>
                  </div>
                ))}
                {auditLogs.length === 0 && (
                  <p className="text-center text-stone-400 italic py-8">No audit logs available.</p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
