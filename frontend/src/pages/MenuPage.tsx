/**
 * The menu: browse, filter, and add to the cart.
 *
 * Category and search filtering happen client-side. The menu is a small, fully
 * loaded list, so filtering locally is instant, whereas a request per keystroke
 * would feel slower and load the server for no gain. The API supports both
 * filters too, for when the menu outgrows a single response.
 */

import { useMemo, useState } from 'react';

import { CartSummary } from '../components/CartSummary';
import { ErrorBlock, EmptyState, MenuSkeleton } from '../components/Feedback';
import { SearchIcon } from '../components/Icons';
import { MenuItemCard } from '../components/MenuItemCard';
import { useCart } from '../cart/CartContext';
import { useMenu } from '../hooks/useMenu';
import type { MenuItem } from '../types';

const ALL_CATEGORIES = 'All';

export function MenuPage() {
  const { items, categories, isLoading, error, reload } = useMenu();
  const { add, increment, decrement, quantityFor } = useCart();

  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState('');

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory =
        activeCategory === ALL_CATEGORIES || item.category === activeCategory;
      const matchesSearch =
        needle === '' ||
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle);
      return matchesCategory && matchesSearch;
    });
  }, [items, activeCategory, search]);

  const grouped = useMemo(() => groupByCategory(visibleItems), [visibleItems]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl">
          What are you hungry for?
        </h1>
        <p className="mt-2 text-stone-600">
          Order in a couple of taps and watch your food make its way to you.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div>
          <div className="mb-6 space-y-4">
            <div className="relative">
              <SearchIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search dishes"
                aria-label="Search the menu"
                className="field-input pl-10"
              />
            </div>

            {categories.length > 0 && (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Filter by category"
              >
                {[ALL_CATEGORIES, ...categories].map((category) => {
                  const isActive = category === activeCategory;
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      aria-pressed={isActive}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {isLoading && <MenuSkeleton />}

          {!isLoading && error && (
            <ErrorBlock title="Could not load the menu" message={error} onRetry={reload} />
          )}

          {!isLoading && !error && visibleItems.length === 0 && (
            <EmptyState
              title="Nothing matches that"
              message="Try a different search term or category."
              action={
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSearch('');
                    setActiveCategory(ALL_CATEGORIES);
                  }}
                >
                  Clear filters
                </button>
              }
            />
          )}

          {!isLoading && !error && visibleItems.length > 0 && (
            <div className="space-y-10">
              {grouped.map(([category, categoryItems]) => (
                <section key={category} aria-labelledby={`category-${category}`}>
                  <h2
                    id={`category-${category}`}
                    className="mb-4 text-lg font-bold text-stone-900"
                  >
                    {category}
                  </h2>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {categoryItems.map((item) => (
                      <MenuItemCard
                        key={item.id}
                        item={item}
                        quantity={quantityFor(item.id)}
                        onAdd={add}
                        onIncrement={increment}
                        onDecrement={decrement}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Sticky on desktop so the running total is always in view; a normal
            block on mobile, where a floating panel would eat the screen. */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <div className="card overflow-hidden">
            <h2 className="border-b border-stone-200 px-4 py-3 font-bold text-stone-900">
              Your order
            </h2>
            <CartSummary />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Group items by category, preserving the API's ordering. */
function groupByCategory(items: MenuItem[]): Array<[string, MenuItem[]]> {
  const groups = new Map<string, MenuItem[]>();
  for (const item of items) {
    const existing = groups.get(item.category);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.category, [item]);
    }
  }
  return [...groups.entries()];
}
