import React from 'react';
import { Volume2, Plus, Minus, AlertTriangle, Flame, Leaf } from 'lucide-react';
import { formatDualPrice } from '../lib/orderMath';
import { MenuItem } from '../types';

interface MenuItemCardProps {
  item: MenuItem;
  index: number;
  isCurrentlySpoken: boolean;
  quantityInCart: number;
  onHearItem: (item: MenuItem, index: number) => void;
  onAddToCart: (item: MenuItem) => void;
  onRemoveFromCart: (item: MenuItem) => void;
}

export const MenuItemCard: React.FC<MenuItemCardProps> = ({
  item,
  index,
  isCurrentlySpoken,
  quantityInCart,
  onHearItem,
  onAddToCart,
  onRemoveFromCart,
}) => {
  const priceDual = formatDualPrice(item.priceKrw);

  return (
    <article
      id={`menu-card-${item.id}`}
      className={`relative rounded-2xl p-4 sm:p-5 transition-all duration-200 border flex flex-col justify-between ${
        isCurrentlySpoken
          ? 'bg-amber-50/90 border-amber-500 shadow-md ring-2 ring-amber-400'
          : item.available
          ? 'bg-white border-stone-200 hover:border-amber-400/80 hover:shadow-md'
          : 'bg-stone-100 border-stone-200 opacity-60'
      }`}
      aria-label={`Menu item ${index}: ${item.englishName}, ${item.koreanName}, ${priceDual.won}`}
    >
      <div>
        {/* Top badges */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200/80">
              #{index}
            </span>
            {item.isSpicy && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 flex items-center gap-1">
                <Flame className="w-3 h-3 text-red-500" />
                <span>매운맛</span>
              </span>
            )}
            {item.isVegetarian && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <Leaf className="w-3 h-3 text-emerald-600" />
                <span>채식</span>
              </span>
            )}
            {item.needsConfirmation && (
              <span
                id={`needs-conf-${item.id}`}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1"
                title="점주 확인 필요"
              >
                <AlertTriangle className="w-3 h-3 text-amber-600" />
                <span>확인 필요</span>
              </span>
            )}
          </div>

          {isCurrentlySpoken && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full animate-pulse border border-amber-300 shrink-0">
              <Volume2 className="w-3 h-3" />
              <span>재생 중</span>
            </span>
          )}
        </div>

        {/*
          Keep English menu content in the MenuItem data for speech and voice
          ordering, but do not render it visually on the Korean menu card.
        */}
        <div className="mb-3">
          <h2 className="text-lg sm:text-xl font-bold text-amber-800 leading-snug tracking-wide">
            {item.koreanName}
          </h2>
        </div>

        {/* Display only the Korean won price; English speech still uses priceDual.won. */}
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-lg sm:text-xl font-extrabold text-stone-950 tracking-tight">
            {priceDual.krw}
          </span>
        </div>
      </div>

      {/* Action buttons with generous touch targets (min 44px) */}
      <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
        {/* Hear Item button */}
        <button
          id={`btn-hear-item-${item.id}`}
          onClick={() => onHearItem(item, index)}
          disabled={!item.available}
          className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-stone-300 hover:border-stone-400 bg-stone-50 hover:bg-stone-100 text-stone-800 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-amber-500 cursor-pointer"
          aria-label={`Hear ${item.englishName}, ${priceDual.won} read aloud`}
        >
          <Volume2 className="w-4 h-4 text-stone-600" />
          <span>듣기</span>
        </button>

        {/* Add to order / Quantity selector */}
        {quantityInCart === 0 ? (
          <button
            id={`btn-add-item-${item.id}`}
            onClick={() => onAddToCart(item)}
            disabled={!item.available}
            className={`flex-1 min-h-[44px] px-3 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-amber-500 cursor-pointer ${
              item.available
                ? 'bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-xs'
                : 'bg-stone-200 text-stone-400 cursor-not-allowed'
            }`}
            aria-label={`Add ${item.englishName} to order`}
          >
            <Plus className="w-4 h-4" />
            <span>{item.available ? '주문 담기' : '품절'}</span>
          </button>
        ) : (
          <div
            className="flex-1 flex items-center justify-between bg-stone-900 text-white rounded-xl px-2 py-1 min-h-[44px]"
            role="group"
            aria-label={`Quantity of ${item.englishName} in order: ${quantityInCart}`}
          >
            <button
              id={`btn-qty-minus-${item.id}`}
              onClick={() => onRemoveFromCart(item)}
              className="w-8 h-8 rounded-lg bg-stone-800 hover:bg-stone-700 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
              aria-label={`Decrease quantity of ${item.englishName}`}
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="font-extrabold text-sm px-2">
              {quantityInCart}
            </span>
            <button
              id={`btn-qty-plus-${item.id}`}
              onClick={() => onAddToCart(item)}
              className="w-8 h-8 rounded-lg bg-stone-800 hover:bg-stone-700 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
              aria-label={`Increase quantity of ${item.englishName}`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
};
