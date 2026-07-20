"use client";

import { motion } from "framer-motion";

/**
 * Per-page enter transition for dashboard routes. A gentle fade on navigation
 * so the Φ world feels continuous instead of hard-cutting.
 *
 * IMPORTANT: opacity ONLY — no transform. A `transform` on this wrapper would
 * turn it into the containing block for the fixed TopNav and the fixed overlays
 * (meditation / mentor mode), breaking their positioning. Opacity is safe.
 */
export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
