import { useMemo, useState, useCallback, useRef } from 'react';
import type { Component, ComponentStatus } from '../api/appsync';

interface HillChartProps {
  components: Component[];
  onComponentClick?: (component: Component) => void;
  // Shape Up: callback when user drags a component to update its hillPhase
  onHillPhaseChange?: (componentId: string, hillPhase: number) => void;
  // Enable dragging for Shape Up workflows
  enableDragging?: boolean;
}

// Map status to hill position (0-100, where 50 is the peak)
// If hillPhase is provided (Shape Up), use that instead of status-based calculation
function getHillPosition(
  status: ComponentStatus,
  priority: number = 50,
  hillPhase?: number | null
): number {
  // Shape Up: use manual hillPhase if available
  if (hillPhase !== undefined && hillPhase !== null) {
    return Math.max(0, Math.min(100, hillPhase));
  }

  // Fallback: map status to position
  switch (status) {
    case 'PLANNING':
      // Early uphill: 10-30%
      return 10 + (priority / 100) * 20;
    case 'IN_PROGRESS':
      // Mid-hill based on priority
      // Lower priority = early uphill (30-45%)
      // Higher priority = late uphill or early downhill (45-65%)
      return 30 + (priority / 100) * 35;
    case 'BLOCKED':
      // Stuck on the hill - show at current position with warning
      return 40 + (priority / 100) * 15;
    case 'REVIEW':
      // Late downhill: 70-85%
      return 70 + (priority / 100) * 15;
    case 'COMPLETED':
      // Done: 95-100% (off the hill)
      return 95 + (priority / 100) * 5;
    default:
      return 50;
  }
}

// Calculate Y position on the hill curve
function getHillY(x: number): number {
  // Parabolic hill: y = -4(x - 0.5)^2 + 1
  // Where x is 0-1 and y is 0-1
  const normalizedX = x / 100;
  const y = -4 * Math.pow(normalizedX - 0.5, 2) + 1;
  return Math.max(0, y);
}

const typeColors: Record<string, string> = {
  EPIC: '#8b5cf6',
  FEATURE: '#3b82f6',
  STORY: '#06b6d4',
  TASK: '#10b981',
  BUG: '#ef4444',
};

const statusIndicators: Record<ComponentStatus, { color: string; label: string }> = {
  PLANNING: { color: '#8b5cf6', label: 'Planning' },
  IN_PROGRESS: { color: '#06b6d4', label: 'In Progress' },
  BLOCKED: { color: '#ef4444', label: 'Blocked' },
  REVIEW: { color: '#f59e0b', label: 'Review' },
  COMPLETED: { color: '#10b981', label: 'Completed' },
};

export function HillChart({
  components,
  onComponentClick,
  onHillPhaseChange,
  enableDragging = false,
}: HillChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // SVG dimensions (moved up for drag calculation)
  const width = 800;
  const height = 300;
  const padding = 40;
  const chartWidth = width - padding * 2;

  // Handle drag start
  const handleDragStart = useCallback(
    (componentId: string, e: React.MouseEvent) => {
      if (!enableDragging || !onHillPhaseChange) return;
      e.preventDefault();
      setDraggingId(componentId);
    },
    [enableDragging, onHillPhaseChange]
  );

  // Handle drag move
  const handleDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingId || !svgRef.current || !onHillPhaseChange) return;

      const svg = svgRef.current;
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;

      // Convert mouse position to SVG coordinates
      const scaleX = viewBox.width / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;

      // Convert to hill position (0-100)
      const hillPhase = Math.max(
        0,
        Math.min(100, ((mouseX - padding) / chartWidth) * 100)
      );

      onHillPhaseChange(draggingId, Math.round(hillPhase));
    },
    [draggingId, onHillPhaseChange, chartWidth, padding]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  // Calculate positions for each component
  const chartData = useMemo(() => {
    return components
      .filter((comp) => comp.status !== 'COMPLETED') // Don't show completed items on hill
      .map((comp) => {
        // Use hillPhase if available (Shape Up), otherwise use status-based position
        const x = getHillPosition(comp.status, comp.priority ?? 50, comp.hillPhase);
        const y = getHillY(x);
        return {
          ...comp,
          x,
          y,
        };
      });
  }, [components]);

  // Group components at similar positions to avoid overlap
  const groupedData = useMemo(() => {
    const groups: Map<string, typeof chartData> = new Map();
    chartData.forEach((item) => {
      const key = `${Math.round(item.x / 5) * 5}`; // Group within 5% ranges
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });
    return groups;
  }, [chartData]);

  const completedCount = components.filter((c) => c.status === 'COMPLETED').length;

  if (components.length === 0) {
    return (
      <div className="text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
        <p className="text-slate-400">No components to display on hill chart.</p>
      </div>
    );
  }

  // SVG dimensions (note: width, height, padding, chartWidth defined above for drag calculation)
  const chartHeight = height - padding * 2;

  // Generate hill curve path
  const hillPath = useMemo(() => {
    const points: string[] = [];
    for (let x = 0; x <= 100; x += 2) {
      const y = getHillY(x);
      const svgX = padding + (x / 100) * chartWidth;
      const svgY = padding + chartHeight - y * chartHeight * 0.8;
      points.push(`${x === 0 ? 'M' : 'L'} ${svgX} ${svgY}`);
    }
    return points.join(' ');
  }, [chartWidth, chartHeight]);

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Hill Chart</h3>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>{chartData.length} in progress</span>
          <span className="text-emerald-400">{completedCount} completed</span>
        </div>
      </div>

      {/* Hill Chart SVG */}
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className={`w-full min-w-[600px] ${draggingId ? 'cursor-grabbing' : ''}`}
          style={{ maxHeight: '350px' }}
          onMouseMove={draggingId ? handleDragMove : undefined}
          onMouseUp={handleDragEnd}
          onMouseLeave={handleDragEnd}
        >
          {/* Background gradient */}
          <defs>
            <linearGradient id="hillGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* Hill fill */}
          <path
            d={`${hillPath} L ${padding + chartWidth} ${padding + chartHeight} L ${padding} ${padding + chartHeight} Z`}
            fill="url(#hillGradient)"
          />

          {/* Hill curve */}
          <path
            d={hillPath}
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
          />

          {/* Center line (peak) */}
          <line
            x1={padding + chartWidth / 2}
            y1={padding}
            x2={padding + chartWidth / 2}
            y2={padding + chartHeight}
            stroke="#475569"
            strokeDasharray="4 4"
          />

          {/* Labels */}
          <text
            x={padding + chartWidth * 0.25}
            y={height - 10}
            textAnchor="middle"
            className="fill-violet-400 text-xs"
          >
            Figuring things out
          </text>
          <text
            x={padding + chartWidth * 0.75}
            y={height - 10}
            textAnchor="middle"
            className="fill-emerald-400 text-xs"
          >
            Making it happen
          </text>

          {/* Component dots */}
          {Array.from(groupedData.entries()).map(([, items]) => {
            return items.map((item, idx) => {
              const svgX = padding + (item.x / 100) * chartWidth;
              const baseY = padding + chartHeight - item.y * chartHeight * 0.8;
              // Offset vertically if multiple items at same position
              const svgY = baseY - idx * 18;
              const isHovered = hoveredId === item.id;
              const isDragging = draggingId === item.id;
              const dotColor = typeColors[item.type] || '#64748b';

              return (
                <g key={item.id}>
                  {/* Connection line to hill */}
                  {idx > 0 && (
                    <line
                      x1={svgX}
                      y1={svgY + 6}
                      x2={svgX}
                      y2={baseY}
                      stroke="#475569"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  )}

                  {/* Dot */}
                  <circle
                    cx={svgX}
                    cy={svgY}
                    r={isDragging ? 12 : isHovered ? 10 : 8}
                    fill={dotColor}
                    stroke={
                      isDragging
                        ? '#3b82f6'
                        : item.status === 'BLOCKED'
                          ? '#ef4444'
                          : '#1e293b'
                    }
                    strokeWidth={isDragging ? 3 : item.status === 'BLOCKED' ? 3 : 2}
                    className={`transition-all ${
                      enableDragging ? 'cursor-grab' : 'cursor-pointer'
                    } ${isDragging ? 'cursor-grabbing' : ''}`}
                    onMouseEnter={() => !draggingId && setHoveredId(item.id)}
                    onMouseLeave={() => !draggingId && setHoveredId(null)}
                    onMouseDown={(e) => handleDragStart(item.id, e)}
                    onClick={() => !enableDragging && onComponentClick?.(item)}
                  />

                  {/* Blocked indicator */}
                  {item.status === 'BLOCKED' && (
                    <text
                      x={svgX}
                      y={svgY - 14}
                      textAnchor="middle"
                      className="text-xs fill-red-400"
                    >
                      ⚠️
                    </text>
                  )}

                  {/* Tooltip on hover */}
                  {isHovered && !isDragging && (
                    <g>
                      <rect
                        x={svgX - 75}
                        y={svgY - 55}
                        width="150"
                        height="40"
                        rx="4"
                        fill="#1e293b"
                        stroke="#475569"
                      />
                      <text
                        x={svgX}
                        y={svgY - 38}
                        textAnchor="middle"
                        className="text-xs fill-white font-medium"
                      >
                        {item.name.length > 20 ? `${item.name.slice(0, 20)}...` : item.name}
                      </text>
                      <text
                        x={svgX}
                        y={svgY - 22}
                        textAnchor="middle"
                        className="text-xs fill-slate-400"
                      >
                        {/* Show hill phase for Shape Up, otherwise show status */}
                        {item.hillPhase !== undefined && item.hillPhase !== null
                          ? `${item.x <= 50 ? 'Figuring out' : 'Making it happen'} (${Math.round(item.x)}%)`
                          : `${statusIndicators[item.status].label} • ${item.type}`}
                      </text>
                    </g>
                  )}
                </g>
              );
            });
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-slate-700 text-xs">
        <span className="text-slate-400">Component types:</span>
        {Object.entries(typeColors).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-slate-400">{type}</span>
          </div>
        ))}
      </div>

      {/* Dragging hint for Shape Up */}
      {enableDragging && (
        <div className="mt-2 text-xs text-slate-500 italic">
          Drag scopes horizontally to update their hill position
        </div>
      )}

      {/* Completed items summary */}
      {completedCount > 0 && (
        <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-emerald-400 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>{completedCount} item{completedCount !== 1 ? 's' : ''} completed (not shown on hill)</span>
          </div>
        </div>
      )}
    </div>
  );
}
