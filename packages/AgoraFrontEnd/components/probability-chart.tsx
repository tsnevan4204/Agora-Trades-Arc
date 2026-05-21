"use client"

import { useEffect, useState, useRef } from 'react'
import { cn } from '@/lib/utils'

interface DataPoint {
  time: string
  probability: number
}

function generateMockData(points: number = 24): DataPoint[] {
  const data: DataPoint[] = []
  let probability = 65 + Math.random() * 20
  
  for (let i = 0; i < points; i++) {
    probability += (Math.random() - 0.48) * 5
    probability = Math.max(30, Math.min(90, probability))
    
    const hour = (new Date().getHours() - points + i + 24) % 24
    data.push({
      time: `${hour.toString().padStart(2, '0')}:00`,
      probability: Math.round(probability * 10) / 10,
    })
  }
  
  return data
}

export function ProbabilityChart({ 
  className 
}: { 
  className?: string 
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [data] = useState(() => generateMockData(48))
  const [hoveredPoint, setHoveredPoint] = useState<DataPoint | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.scale(dpr, dpr)

    const width = rect.width
    const height = rect.height
    const padding = { top: 20, right: 20, bottom: 30, left: 50 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Calculate scales
    const minProb = Math.min(...data.map(d => d.probability)) - 5
    const maxProb = Math.max(...data.map(d => d.probability)) + 5
    const xScale = (i: number) => padding.left + (i / (data.length - 1)) * chartWidth
    const yScale = (prob: number) => 
      padding.top + ((maxProb - prob) / (maxProb - minProb)) * chartHeight

    // Draw grid lines
    ctx.strokeStyle = 'rgba(139, 125, 107, 0.1)'
    ctx.lineWidth = 1
    
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (i / 4) * chartHeight
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()

      // Y-axis labels
      const prob = maxProb - (i / 4) * (maxProb - minProb)
      ctx.fillStyle = 'rgba(139, 125, 107, 0.6)'
      ctx.font = '11px system-ui'
      ctx.textAlign = 'right'
      ctx.fillText(`${prob.toFixed(0)}%`, padding.left - 8, y + 4)
    }

    // Create gradient for area
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom)
    gradient.addColorStop(0, 'rgba(167, 139, 99, 0.3)')
    gradient.addColorStop(1, 'rgba(167, 139, 99, 0.02)')

    // Draw area
    ctx.beginPath()
    ctx.moveTo(xScale(0), height - padding.bottom)
    data.forEach((point, i) => {
      ctx.lineTo(xScale(i), yScale(point.probability))
    })
    ctx.lineTo(xScale(data.length - 1), height - padding.bottom)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    // Draw line
    ctx.beginPath()
    ctx.strokeStyle = '#a78b63'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    
    data.forEach((point, i) => {
      const x = xScale(i)
      const y = yScale(point.probability)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()

    // Draw glow effect on line
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(167, 139, 99, 0.4)'
    ctx.lineWidth = 6
    ctx.filter = 'blur(4px)'
    data.forEach((point, i) => {
      const x = xScale(i)
      const y = yScale(point.probability)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()
    ctx.filter = 'none'

    // Draw end point
    const lastPoint = data[data.length - 1]
    const lastX = xScale(data.length - 1)
    const lastY = yScale(lastPoint.probability)
    
    // Outer glow
    ctx.beginPath()
    ctx.arc(lastX, lastY, 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(167, 139, 99, 0.3)'
    ctx.fill()
    
    // Inner dot
    ctx.beginPath()
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#a78b63'
    ctx.fill()

    // Handle mouse move for tooltip
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      setMousePos({ x: e.clientX, y: e.clientY })

      // Find nearest data point
      const index = Math.round((x - padding.left) / chartWidth * (data.length - 1))
      if (index >= 0 && index < data.length) {
        setHoveredPoint(data[index])
      } else {
        setHoveredPoint(null)
      }
    }

    const handleMouseLeave = () => {
      setHoveredPoint(null)
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [data])

  return (
    <div ref={containerRef} className={cn('relative w-full h-full', className)}>
      <canvas 
        ref={canvasRef} 
        className="w-full h-full cursor-crosshair"
      />
      
      {/* Tooltip */}
      {hoveredPoint && (
        <div 
          className="fixed z-50 px-3 py-2 rounded-lg bg-card border border-border shadow-lg text-sm pointer-events-none"
          style={{
            left: mousePos.x + 10,
            top: mousePos.y - 40,
          }}
        >
          <div className="text-muted-foreground">{hoveredPoint.time}</div>
          <div className="font-semibold">{hoveredPoint.probability}%</div>
        </div>
      )}
    </div>
  )
}
