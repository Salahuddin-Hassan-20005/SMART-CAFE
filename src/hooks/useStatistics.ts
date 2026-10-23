/**
 * useStatistics Hook
 *
 * Custom React hook for fetching and managing pre-aggregated statistics
 * from Firebase Firestore. Designed to work with Recharts for data visualization.
 */

import { useState, useEffect, useCallback } from "react";
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Interface for best seller item data
 */
export interface BestSellerItem {
  id: string;
  name: string;
  count: number;
  revenue: number;
  category: string;
}

/**
 * Interface for item sales count data
 */
export interface ItemSalesCount {
  [itemId: string]: {
    count: number;
    revenue: number;
    lastSold?: {
      seconds: number;
      nanoseconds: number;
    };
  };
}

/**
 * Interface for statistics document data
 */
export interface StatisticsData {
  id: string;
  period: "daily" | "monthly" | "weekly";
  date?: string;
  month?: string;
  totalTurnover: number;
  totalOrders: number;
  cancelledOrders?: number;
  bestSellers: BestSellerItem[];
  itemSalesCount: ItemSalesCount;
  lastUpdated?: Date;
}

/**
 * Interface for hook return type
 */
interface UseStatisticsReturn {
  statistics: StatisticsData | null;
  loading: boolean;
  error: string | null;
  bestSellersChartData: { name: string; count: number; revenue: number }[];
  categoryChartData: { category: string; count: number; revenue: number }[];
  refresh: () => Promise<void>;
}

/**
 * Format date to daily stats document ID
 */
const formatDailyDocId = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `daily_${year}${month}${day}`;
};

/**
 * Format date to monthly stats document ID
 */
const formatMonthlyDocId = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `monthly_${year}${month}`;
};

/**
 * Convert Firestore data to StatisticsData format
 */
const parseStatisticsData = (
  docId: string,
  data: Record<string, any>,
): StatisticsData => {
  // Parse best sellers map to sorted array
  const bestSellersMap = data.bestSellers || {};
  const bestSellers: BestSellerItem[] = Object.entries(bestSellersMap)
    .map(([id, item]: [string, any]) => ({
      id,
      name: item.name,
      count: item.count || 0,
      revenue: item.revenue || 0,
      category: item.category || "Unknown",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 best sellers

  return {
    id: docId,
    period: data.period || "daily",
    date: data.date,
    month: data.month,
    totalTurnover: data.totalTurnover || 0,
    totalOrders: data.totalOrders || 0,
    cancelledOrders: data.cancelledOrders || 0,
    bestSellers,
    itemSalesCount: data.itemSalesCount || {},
    lastUpdated: data.lastUpdated?.toDate?.() || data.createdAt?.toDate?.(),
  };
};

/**
 * Custom hook to fetch and manage statistics data
 *
 * @param period - The period to fetch statistics for ('daily' or 'monthly')
 * @param date - Optional date to fetch statistics for (defaults to today)
 * @param realtime - Whether to use real-time updates via onSnapshot (disabled by default due to SDK issues)
 * @returns Statistics data, loading state, error, and chart-ready data arrays
 */
export const useStatistics = (
  period: "daily" | "monthly" = "daily",
  date: Date = new Date(),
  realtime: boolean = false, // Disabled by default due to Firebase SDK internal assertion issues
): UseStatisticsReturn => {
  const [statistics, setStatistics] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatistics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const docId =
        period === "daily" ? formatDailyDocId(date) : formatMonthlyDocId(date);

      const docRef = doc(db, "statistics", docId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = parseStatisticsData(
          docSnap.id,
          docSnap.data() as Record<string, any>,
        );
        setStatistics(data);
      } else {
        // No statistics available for this period
        setStatistics({
          id: docId,
          period,
          totalTurnover: 0,
          totalOrders: 0,
          cancelledOrders: 0,
          bestSellers: [],
          itemSalesCount: {},
        });
      }
    } catch (err) {
      console.error("Error fetching statistics:", err);
      // Handle Firebase SDK internal errors gracefully
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch statistics";
      if (errorMessage.includes("INTERNAL ASSERTION FAILED")) {
        console.warn(
          "Firebase SDK internal error detected. Falling back to empty state.",
        );
        setStatistics({
          id:
            period === "daily"
              ? formatDailyDocId(date)
              : formatMonthlyDocId(date),
          period,
          totalTurnover: 0,
          totalOrders: 0,
          cancelledOrders: 0,
          bestSellers: [],
          itemSalesCount: {},
        });
        setError(null);
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [period, date]);

  // Real-time subscription effect (disabled by default due to SDK issues)
  useEffect(() => {
    // Always use fetch-based approach to avoid Firebase SDK internal assertion errors
    // Real-time listeners can be re-enabled once the SDK issue is resolved
    fetchStatistics();

    // If realtime is explicitly requested, set up polling instead of onSnapshot
    if (realtime) {
      const intervalId = setInterval(() => {
        fetchStatistics();
      }, 30000); // Poll every 30 seconds instead of using real-time listener

      return () => {
        clearInterval(intervalId);
      };
    }
  }, [period, date, realtime, fetchStatistics]);

  // Prepare chart data for Recharts - Best Sellers Bar Chart
  const bestSellersChartData =
    statistics?.bestSellers.map((item) => ({
      name:
        item.name.length > 15 ? item.name.substring(0, 15) + "..." : item.name,
      count: item.count,
      revenue: Math.round(item.revenue * 100) / 100,
    })) || [];

  // Prepare chart data for Recharts - Category Distribution Pie Chart
  const categoryChartData = (() => {
    if (!statistics?.itemSalesCount) return [];

    const categoryMap = new Map<string, { count: number; revenue: number }>();

    Object.entries(statistics.itemSalesCount).forEach(([itemId, raw]) => {
      const data = raw as { count?: number; revenue?: number };
      // Find category from bestSellers
      const bestSeller = statistics.bestSellers.find((bs) => bs.id === itemId);
      const category = bestSeller?.category || "Unknown";

      const existing = categoryMap.get(category) || { count: 0, revenue: 0 };
      categoryMap.set(category, {
        count: existing.count + (data.count || 0),
        revenue: existing.revenue + (data.revenue || 0),
      });
    });

    return Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        revenue: Math.round(data.revenue * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count);
  })();

  return {
    statistics,
    loading,
    error,
    bestSellersChartData,
    categoryChartData,
    refresh: fetchStatistics,
  };
};

/**
 * Hook to fetch multiple days of statistics for trend analysis
 */
export const useStatisticsTrend = (
  days: number = 7,
): {
  trendData: { date: string; turnover: number; orders: number }[];
  loading: boolean;
  error: string | null;
} => {
  const [trendData, setTrendData] = useState<
    { date: string; turnover: number; orders: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrendData = async () => {
      setLoading(true);
      setError(null);

      try {
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - days + 1);

        const startStr = startDate.toISOString().split("T")[0];
        const endStr = today.toISOString().split("T")[0];

        // Query daily statistics for the date range
        const statsRef = collection(db, "statistics");
        const q = query(
          statsRef,
          where("period", "==", "daily"),
          where("date", ">=", startStr),
          where("date", "<=", endStr),
          orderBy("date", "asc"),
          limit(days),
        );

        const snapshot = await getDocs(q);
        const data: { date: string; turnover: number; orders: number }[] = [];

        snapshot.forEach((doc) => {
          const docData = doc.data();
          data.push({
            date: docData.date || doc.id.slice(-8), // Extract YYYYMMDD from doc ID
            turnover: docData.totalTurnover || 0,
            orders: docData.totalOrders || 0,
          });
        });

        // Fill in missing days with zeros
        const filledData: { date: string; turnover: number; orders: number }[] =
          [];
        for (let i = 0; i < days; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i);
          const dateStr = d.toISOString().split("T")[0];
          const shortDate = dateStr.slice(5); // MM-DD format for charts

          const existing = data.find((item) => item.date === dateStr);
          filledData.push({
            date: shortDate,
            turnover: existing?.turnover || 0,
            orders: existing?.orders || 0,
          });
        }

        setTrendData(filledData);
      } catch (err) {
        console.error("Error fetching trend data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch trend data",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchTrendData();
  }, [days]);

  return { trendData, loading, error };
};

/**
 * Hook to get overall summary statistics across multiple periods
 */
export const useStatisticsSummary = () => {
  const [summary, setSummary] = useState({
    todayTurnover: 0,
    todayOrders: 0,
    weekTurnover: 0,
    weekOrders: 0,
    monthTurnover: 0,
    monthOrders: 0,
    avgOrderValue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      setLoading(true);
      setError(null);

      try {
        const today = new Date();
        const todayDocId = formatDailyDocId(today);
        const monthDocId = formatMonthlyDocId(today);

        // Fetch today's stats
        const todayDoc = await getDoc(doc(db, "statistics", todayDocId));
        const todayData = todayDoc.exists() ? todayDoc.data() : null;

        // Fetch month stats
        const monthDoc = await getDoc(doc(db, "statistics", monthDocId));
        const monthData = monthDoc.exists() ? monthDoc.data() : null;

        // Calculate week stats (last 7 days)
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - 6);
        const weekStartStr = weekStart.toISOString().split("T")[0];
        const todayStr = today.toISOString().split("T")[0];

        const statsRef = collection(db, "statistics");
        const q = query(
          statsRef,
          where("period", "==", "daily"),
          where("date", ">=", weekStartStr),
          where("date", "<=", todayStr),
        );

        const weekSnapshot = await getDocs(q);
        let weekTurnover = 0;
        let weekOrders = 0;

        weekSnapshot.forEach((doc) => {
          const data = doc.data();
          weekTurnover += data.totalTurnover || 0;
          weekOrders += data.totalOrders || 0;
        });

        setSummary({
          todayTurnover: todayData?.totalTurnover || 0,
          todayOrders: todayData?.totalOrders || 0,
          weekTurnover,
          weekOrders,
          monthTurnover: monthData?.totalTurnover || 0,
          monthOrders: monthData?.totalOrders || 0,
          avgOrderValue: todayData?.totalOrders
            ? (todayData.totalTurnover || 0) / todayData.totalOrders
            : 0,
        });
      } catch (err) {
        console.error("Error fetching summary:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch summary",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  return { summary, loading, error };
};
