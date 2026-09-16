import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mic,
  ShoppingBag,
  Volume2,
  Sparkles,
  ArrowRight,
  Search,
  Flame,
  Leaf,
  ChevronRight,
  MapPin,
  Utensils,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { Header } from './components/Header';
import { SpeechControllerBar } from './components/SpeechControllerBar';
import { MenuItemCard } from './components/MenuItemCard';
import { VoiceOrderModal } from './components/VoiceOrderModal';
import { GuidedVoiceModal } from './components/GuidedVoiceModal';
import { OrderConfirmationModal } from './components/OrderConfirmationModal';
import { OwnerDashboard } from './components/OwnerDashboard';
import { TelegramSetupModal } from './components/TelegramSetupModal';
import { VisitorOrderHistoryModal } from './components/VisitorOrderHistoryModal';
import { QrCodeManagerModal } from './components/QrCodeManagerModal';
import { QrScannerModal } from './components/QrScannerModal';
import { AriaLiveAnnouncer } from './components/AriaLiveAnnouncer';
import { INITIAL_STALL_MENU } from './data/sampleMenu';
import { calculateOrderTotal, formatDualPrice } from './lib/orderMath';
import { menuVoiceService, SpeechRate, SpeechState } from './lib/speechSynthesis';
import { MenuItem, Order, OrderItem, StallMenu, TelegramConfigStatus } from './types';

interface CartEntry {
  item: MenuItem;
  quantity: number;
  specialRequest?: string;
}

export default function App() {
  // App state
  const [currentRole, setCurrentRole] = useState<'visitor' | 'owner'>('visitor');
  const [activeTable, setActiveTable] = useState<string>('Table 1');
  const [menu, setMenu] = useState<StallMenu>(INITIAL_STALL_MENU);
  const [cart, setCart] = useState<Map<string, CartEntry>>(() => new Map<string, CartEntry>());
  const [telegramStatus, setTelegramStatus] = useState<TelegramConfigStatus | null>(null);

  // Filter & Search states
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyVegetarian, setOnlyVegetarian] = useState<boolean>(false);
  const [onlySpicy, setOnlySpicy] = useState<boolean>(false);

  // Modals
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isGuidedVoiceOpen, setIsGuidedVoiceOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isQrManagerOpen, setIsQrManagerOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const startGuidedVoiceButtonRef = useRef<HTMLButtonElement>(null);

  // Active voice feedback
  const [speechState, setSpeechState] = useState<SpeechState>({
    isPlaying: false,
    isPaused: false,
    currentItemId: null,
    currentIndex: 0,
    rate: 'normal',
    totalItems: 0,
  });
  const [announcement, setAnnouncement] = useState('');

  // Confirmation payload for order modal
  const [pendingOrderItems, setPendingOrderItems] = useState<OrderItem[]>([]);
  const [pendingSpecialRequest, setPendingSpecialRequest] = useState<string | undefined>(undefined);
  const [pendingTranscript, setPendingTranscript] = useState<string | undefined>(undefined);
  const [orderIdempotencyKey, setOrderIdempotencyKey] = useState<string>('');

  const generateNewIdempotencyKey = () =>
    `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Parse URL parameters on load
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tableParam = params.get('table');
      if (tableParam) {
        setActiveTable(tableParam);
      }
      const roleParam = params.get('role');
      if (roleParam === 'owner' || roleParam === 'visitor') {
        setCurrentRole(roleParam);
      }
      const qrParam = params.get('qr');
      if (qrParam === '1' || qrParam === 'true') {
        setIsQrManagerOpen(true);
      }
      const scannerParam = params.get('scanner');
      if (scannerParam === '1' || scannerParam === 'true') {
        setIsQrScannerOpen(true);
      }
      const guidedParam = params.get('guided');
      if (guidedParam === '1' || guidedParam === 'true') {
        setIsGuidedVoiceOpen(true);
      }
    } catch (e) {
      console.warn('Could not parse URL query parameters', e);
    }
  }, []);

  // Initial load: subscribe to voice player & fetch telegram bot status
  useEffect(() => {
    menuVoiceService.setCallbacks(
      (state) => setSpeechState(state),
      (msg) => setAnnouncement(msg)
    );

    const checkTelegramStatus = async () => {
      try {
        const res = await fetch('/api/telegram/status');
        if (res.ok) {
          const data: TelegramConfigStatus = await res.json();
          setTelegramStatus(data);
        }
      } catch (err) {
        console.warn('Could not reach telegram status api:', err);
      }
    };

    checkTelegramStatus();

    return () => {
      menuVoiceService.stop();
    };
  }, []);

  const handleAnnounce = useCallback((msg: string) => {
    setAnnouncement(msg);
  }, []);

  // Speech controls
  const handleReadFullMenu = () => {
    menuVoiceService.readFullMenu(filteredItems);
    handleAnnounce(`Reading full menu out loud.`);
  };

  const handlePauseSpeech = () => {
    menuVoiceService.pause();
    handleAnnounce('Speech paused.');
  };

  const handleResumeSpeech = () => {
    menuVoiceService.resume();
    handleAnnounce('Speech resumed.');
  };

  const handleStopSpeech = () => {
    menuVoiceService.stop();
    handleAnnounce('Speech stopped.');
  };

  const handleRepeatSpeech = () => {
    menuVoiceService.repeat();
    handleAnnounce('Repeating current item.');
  };

  const handleChangeRate = (rate: SpeechRate) => {
    menuVoiceService.setRate(rate);
    handleAnnounce(`Speed set to ${rate}.`);
  };

  const handleHearSingleItem = (item: MenuItem, index: number) => {
    menuVoiceService.readItem(item, index);
    handleAnnounce(`Reading ${item.englishName}.`);
  };

  // Cart operations
  const handleAddToCart = (item: MenuItem) => {
    setCart((prev: Map<string, CartEntry>) => {
      const next = new Map<string, CartEntry>(prev);
      const existing = next.get(item.id);
      if (existing) {
        next.set(item.id, { ...existing, quantity: existing.quantity + 1 });
      } else {
        next.set(item.id, { item, quantity: 1 });
      }
      return next;
    });
    handleAnnounce(`Added ${item.englishName} to cart.`);
  };

  const handleRemoveFromCart = (item: MenuItem) => {
    setCart((prev: Map<string, CartEntry>) => {
      const next = new Map<string, CartEntry>(prev);
      const existing = next.get(item.id);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        next.delete(item.id);
      } else {
        next.set(item.id, { ...existing, quantity: existing.quantity - 1 });
      }
      return next;
    });
    handleAnnounce(`Removed one ${item.englishName} from cart.`);
  };

  // Handle voice order result
  const handleVoiceOrderInterpreted = (items: OrderItem[], transcript: string) => {
    setPendingOrderItems(items);
    setPendingTranscript(transcript);
    setPendingSpecialRequest(undefined);
    setOrderIdempotencyKey(generateNewIdempotencyKey());
    setIsVoiceModalOpen(false);
    setIsConfirmModalOpen(true);
  };

  // Open cart for checkout
  const handleOpenCartConfirmation = () => {
    if (cart.size === 0) {
      handleAnnounce('Your cart is empty. Please add items to order.');
      return;
    }
    const items: OrderItem[] = Array.from(cart.values()).map(({ item, quantity, specialRequest }) => ({
      menuItemId: item.id,
      englishName: item.englishName,
      koreanName: item.koreanName,
      unitPriceKrw: item.priceKrw,
      quantity,
      specialRequest,
    }));
    setPendingOrderItems(items);
    setPendingSpecialRequest(undefined);
    setPendingTranscript(undefined);
    setOrderIdempotencyKey(generateNewIdempotencyKey());
    setIsConfirmModalOpen(true);
  };

  const handleCloseConfirmModal = () => {
    setIsConfirmModalOpen(false);
    setPendingOrderItems([]);
    setPendingSpecialRequest(undefined);
    setPendingTranscript(undefined);
    setOrderIdempotencyKey('');
  };

  const handleOrderCompleted = (_completedOrder: Order) => {
    setCart(new Map());
    handleCloseConfirmModal();
  };

  const handleReorder = (order: Order) => {
    setCart(() => {
      const updated = new Map<string, CartEntry>();
      order.items.forEach((item) => {
        const menuItem = menu.items.find((m) => m.id === item.menuItemId) || {
          id: item.menuItemId,
          koreanName: item.koreanName,
          englishName: item.englishName,
          priceKrw: item.unitPriceKrw,
          available: true,
        };
        updated.set(item.menuItemId, {
          item: menuItem,
          quantity: item.quantity,
          specialRequest: item.specialRequest,
        });
      });
      return updated;
    });
    handleAnnounce(`Loaded ${order.items.length} items from past order into your cart.`);
  };

  // Compute total cart quantity and sum
  const cartEntries: CartEntry[] = useMemo(() => Array.from(cart?.values?.() || []), [cart]);
  const cartTotalQty = useMemo(
    () => (cartEntries || []).reduce((acc: number, i: CartEntry) => acc + (i?.quantity || 0), 0),
    [cartEntries]
  );
  const cartItemsList: OrderItem[] = useMemo(
    () =>
      cartEntries.map(({ item, quantity, specialRequest }) => ({
        menuItemId: item.id,
        englishName: item.englishName,
        koreanName: item.koreanName,
        unitPriceKrw: item.priceKrw,
        quantity,
        specialRequest,
      })),
    [cartEntries]
  );
  const cartTotalKrw = useMemo(() => calculateOrderTotal(cartItemsList), [cartItemsList]);

  const handleGuidedVoiceOrderCompleted = useCallback(
    (orderId: string) => {
      setCart(new Map());
      handleAnnounce(`Order ${orderId} sent successfully to stall owner!`);
    },
    [handleAnnounce]
  );

  // Available categories extracted from menu
  const categories = useMemo(() => {
    const set = new Set<string>();
    menu.items.forEach((item) => {
      if (item.category) set.add(item.category);
    });
    return Array.from(set);
  }, [menu.items]);

  // Filtered menu items
  const filteredItems = useMemo(() => {
    return menu.items.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (onlyVegetarian && !item.isVegetarian) {
        return false;
      }
      if (onlySpicy && !item.isSpicy) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesEn = item.englishName.toLowerCase().includes(q);
        const matchesKo = item.koreanName.includes(q);
        const matchesDesc = item.description?.toLowerCase().includes(q);
        return matchesEn || matchesKo || matchesDesc;
      }
      return true;
    });
  }, [menu.items, selectedCategory, onlyVegetarian, onlySpicy, searchQuery]);

  return (
    <div className="min-h-screen bg-stone-100/80 text-stone-900 flex flex-col font-sans">
      {/* Screen Reader Live Region */}
      <AriaLiveAnnouncer announcement={announcement} />

      {/* Top Header */}
      <Header
        stallName={menu.stallName}
        stallNameEn={menu.stallNameEn}
        stallLocation={menu.stallLocation}
        currentRole={currentRole}
        onRoleChange={(role) => {
          setCurrentRole(role);
          menuVoiceService.stop();
        }}
        cartItemCount={cartTotalQty}
        onOpenCart={handleOpenCartConfirmation}
        telegramStatus={telegramStatus}
        onOpenTelegramHelp={() => setIsTelegramModalOpen(true)}
        onOpenHistory={() => setIsHistoryModalOpen(true)}
        onOpenQrCode={() => setIsQrManagerOpen(true)}
        activeTable={activeTable}
        onTableChange={(tbl) => setActiveTable(tbl)}
      />

      {/* Floating Speech Controller Bar (appears docked when audio is active) */}
      <SpeechControllerBar
        items={menu.items}
        speechState={speechState}
        onReadFullMenu={handleReadFullMenu}
        onPause={handlePauseSpeech}
        onResume={handleResumeSpeech}
        onStop={handleStopSpeech}
        onRepeat={handleRepeatSpeech}
        onChangeRate={handleChangeRate}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-7">
        {currentRole === 'visitor' ? (
          <div className="space-y-6 sm:space-y-8">
            {/* Elegant Tourist Welcome & Voice Actions Banner */}
            <div className="relative overflow-hidden bg-stone-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-stone-800/90">
              {/* Subtle warm decorative glow */}
              <div className="absolute -top-24 -right-24 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div className="space-y-2 max-w-xl">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 text-xs font-semibold border border-amber-500/25">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>English Tourist Audio & Voice Kiosk</span>
                  </div>

                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                    Authentic Korean Street Food, <br className="hidden sm:inline" />
                    <span className="text-amber-400">Spoken in English</span>
                  </h2>

                  <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
                    Listen to natural English translations and dish pronunciations, or order directly with your voice.
                    Orders are formatted in Korean and transmitted instantly to the kitchen Telegram bot!
                  </p>
                </div>

                {/* Primary Voice Actions */}
                <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 w-full lg:w-72 shrink-0">
                  <button
                    ref={startGuidedVoiceButtonRef}
                    id="btn-start-guided-voice"
                    onClick={() => {
                      menuVoiceService.stop();
                      setIsGuidedVoiceOpen(true);
                    }}
                    className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-950/40 transition-transform active:scale-98 cursor-pointer focus-visible:ring-4 focus-visible:ring-emerald-400"
                    aria-label="Start guided voice ordering assistant"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-pulse" />
                    <span>Guided Voice Order</span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      id="btn-hear-full-menu-hero"
                      onClick={handleReadFullMenu}
                      className="min-h-[44px] px-3 py-2.5 rounded-2xl bg-stone-900 hover:bg-stone-800 text-amber-300 border border-stone-700/80 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      title="Read entire menu out loud"
                    >
                      <Volume2 className="w-4 h-4 text-amber-400" />
                      <span>Hear Menu</span>
                    </button>

                    <button
                      id="hero-speak-order-button"
                      onClick={() => {
                        menuVoiceService.stop();
                        setIsVoiceModalOpen(true);
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-2xl bg-stone-900 hover:bg-stone-800 text-stone-200 hover:text-white border border-stone-700/80 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      title="Quick speech recognition order"
                    >
                      <Mic className="w-4 h-4 text-amber-400" />
                      <span>Quick Mic</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Menu Section & Interactive Filters */}
            <section aria-label="Korean Stall Menu Items" className="space-y-4">
              {/* Filter controls row */}
              <div className="bg-white rounded-2xl p-4 border border-stone-200/90 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                {/* Search Bar */}
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search dishes (e.g. Kimchi, Beef, Tteokbokki)..."
                    className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Dietary Filter Toggles */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOnlyVegetarian(!onlyVegetarian)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                      onlyVegetarian
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-400 shadow-xs'
                        : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    <Leaf className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Vegetarian</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOnlySpicy(!onlySpicy)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                      onlySpicy
                        ? 'bg-red-100 text-red-900 border-red-400 shadow-xs'
                        : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5 text-red-600" />
                    <span>Spicy</span>
                  </button>
                </div>
              </div>

              {/* Category Pill Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none" role="tablist">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === 'all'
                      ? 'bg-stone-900 text-white shadow-xs'
                      : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  All Dishes ({menu.items.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-stone-900 text-white shadow-xs'
                        : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Seating Banner Note */}
              <div className="flex items-center justify-between text-xs text-stone-500 px-1">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-amber-600" />
                  <span>
                    Orders will be dispatched for <strong className="text-stone-800">{activeTable}</strong>
                  </span>
                </div>
                <span>Showing {filteredItems.length} items</span>
              </div>

              {/* Menu Item Cards Grid */}
              {filteredItems.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 text-center border border-stone-200">
                  <Utensils className="w-8 h-8 text-stone-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-stone-700">No dishes match your filter</p>
                  <p className="text-xs text-stone-400 mt-1">Try resetting the search or dietary filters</p>
                  <button
                    onClick={() => {
                      setSelectedCategory('all');
                      setSearchQuery('');
                      setOnlyVegetarian(false);
                      setOnlySpicy(false);
                    }}
                    className="mt-3 px-3 py-1.5 rounded-xl bg-stone-900 text-white text-xs font-semibold"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredItems.map((item, index) => {
                    const itemInCart = cart.get(item.id);
                    const isSpoken = speechState.currentItemId === item.id;
                    return (
                      <MenuItemCard
                        key={item.id}
                        item={item}
                        index={index + 1}
                        isCurrentlySpoken={isSpoken}
                        quantityInCart={itemInCart ? itemInCart.quantity : 0}
                        onHearItem={handleHearSingleItem}
                        onAddToCart={handleAddToCart}
                        onRemoveFromCart={handleRemoveFromCart}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* Stall Owner Dashboard */
          <OwnerDashboard
            currentMenu={menu}
            onMenuUpdated={(updated) => {
              setMenu(updated);
            }}
            onPreviewVisitor={() => {
              setCurrentRole('visitor');
            }}
            telegramStatus={telegramStatus}
            onOpenTelegramSetup={() => setIsTelegramModalOpen(true)}
            onAnnounce={handleAnnounce}
          />
        )}
      </main>

      {/* Floating Bottom Cart Bar (Visitor mode only, appears when cart has items) */}
      {currentRole === 'visitor' && cartTotalQty > 0 && (
        <div
          id="sticky-visitor-cart-bar"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[95%] max-w-xl bg-stone-950 text-white rounded-2xl p-3 shadow-2xl border border-amber-500/40 animate-in slide-in-from-bottom-3 duration-150"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-stone-950 flex items-center justify-center font-extrabold shrink-0">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-amber-400">
                    {cartTotalQty} {cartTotalQty === 1 ? 'item' : 'items'}
                  </span>
                  <span className="text-[11px] text-stone-400">• for {activeTable}</span>
                </div>
                <div className="text-sm sm:text-base font-extrabold text-white">
                  {formatDualPrice(cartTotalKrw).krw}{' '}
                  <span className="text-xs font-medium text-stone-400">
                    ({formatDualPrice(cartTotalKrw).won})
                  </span>
                </div>
              </div>
            </div>

            <button
              id="btn-floating-cart-review"
              onClick={handleOpenCartConfirmation}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-extrabold text-xs sm:text-sm flex items-center gap-1.5 transition-transform active:scale-95 shadow-xs cursor-pointer shrink-0"
            >
              <span>Review Order</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Guided Voice Ordering Modal */}
      <GuidedVoiceModal
        isOpen={isGuidedVoiceOpen}
        onClose={() => setIsGuidedVoiceOpen(false)}
        menuItems={menu.items}
        initialItems={cartItemsList}
        idempotencyKey={orderIdempotencyKey || undefined}
        triggerButtonRef={startGuidedVoiceButtonRef}
        onOrderCompleted={handleGuidedVoiceOrderCompleted}
        tableNumber={activeTable}
      />

      {/* Voice Ordering Modal */}
      <VoiceOrderModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        availableMenu={menu.items}
        onOrderInterpreted={handleVoiceOrderInterpreted}
        onAnnounce={handleAnnounce}
      />

      {/* Order Confirmation & Telegram Delivery Modal */}
      {isConfirmModalOpen && (
        <OrderConfirmationModal
          isOpen={isConfirmModalOpen}
          onClose={handleCloseConfirmModal}
          orderItems={pendingOrderItems}
          availableMenu={menu.items}
          tableNumber={activeTable}
          specialRequest={pendingSpecialRequest}
          originalTranscript={pendingTranscript}
          idempotencyKey={orderIdempotencyKey}
          onOrderCompleted={handleOrderCompleted}
          onOrderItemsChange={(updated) => setPendingOrderItems(updated)}
          onSpecialRequestChange={(val) => setPendingSpecialRequest(val)}
          onAnnounce={handleAnnounce}
          telegramStatus={telegramStatus}
        />
      )}

      {/* Telegram Setup & Testing Guide Modal */}
      <TelegramSetupModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        telegramStatus={telegramStatus}
      />

      {/* Visitor Persistent Order History & Receipts Modal */}
      <VisitorOrderHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        onReorder={handleReorder}
      />

      {/* Table QR Code Tent Card Modal (Owner) */}
      <QrCodeManagerModal
        isOpen={isQrManagerOpen}
        onClose={() => setIsQrManagerOpen(false)}
        menu={menu}
        initialTable={activeTable}
        onPreviewVisitor={() => {
          setIsQrManagerOpen(false);
          setCurrentRole('visitor');
        }}
      />

      {/* QR Scanner Simulator Modal */}
      <QrScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onScanSuccess={(tableId) => {
          setActiveTable(tableId);
          setIsQrScannerOpen(false);
          handleAnnounce(`Table switched to ${tableId}`);
        }}
      />
    </div>
  );
}
