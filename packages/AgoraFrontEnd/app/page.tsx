import { Navbar } from '@/components/navbar'
import { HeroSection } from '@/components/hero-section'
import { MarketsShowcase } from '@/components/markets-showcase'
import { FeaturesSection } from '@/components/features-section'
import { HowItWorks } from '@/components/how-it-works'
import { OrderBookDemo } from '@/components/order-book-demo'
import { DataSection } from '@/components/data-section'
import { CTASection } from '@/components/cta-section'
import { Footer } from '@/components/footer'

export default function Home() {
  return (
    <main className="relative">
      <Navbar />
      <HeroSection />
      <MarketsShowcase />
      <FeaturesSection />
      <HowItWorks />
      <OrderBookDemo />
      <DataSection />
      <CTASection />
      <Footer />
    </main>
  )
}
