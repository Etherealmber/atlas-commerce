/**
 * Carousel / step navigator — prev · dots (progress) · next
 */
import { type FC } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface CarouselNavigatorProps {
  totalSlides?: number;
  autoDelay?: number;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  className?: string;
  /** When true, prev is disabled on first slide */
  disableWrap?: boolean;
}

export const CarouselNavigator: FC<CarouselNavigatorProps> = ({
  totalSlides = 4,
  autoDelay = 5000,
  currentIndex,
  onIndexChange,
  className = '',
  disableWrap = true,
}) => {
  const goPrev = () => {
    if (disableWrap && currentIndex === 0) return;
    onIndexChange((currentIndex - 1 + totalSlides) % totalSlides);
  };
  const goNext = () => {
    if (disableWrap && currentIndex >= totalSlides - 1) return;
    onIndexChange((currentIndex + 1) % totalSlides);
  };

  return (
    <motion.div className={`ac-carousel-nav ${className}`.trim()} layout>
      <ArrowButton onClick={goPrev} disabled={disableWrap && currentIndex === 0} aria-label="Précédent">
        <ChevronLeft size={22} strokeWidth={2.5} />
      </ArrowButton>
      <div className="ac-carousel-dots">
        {Array.from({ length: totalSlides }).map((_, i) => (
          <Indicator
            key={i}
            isActive={i === currentIndex}
            autoDelay={autoDelay}
            onClick={() => onIndexChange(i)}
          />
        ))}
      </div>
      <ArrowButton
        onClick={goNext}
        disabled={disableWrap && currentIndex >= totalSlides - 1}
        aria-label="Suivant"
      >
        <ChevronRight size={22} strokeWidth={2.5} />
      </ArrowButton>
    </motion.div>
  );
};

function ArrowButton({
  children,
  onClick,
  disabled,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      className={`ac-carousel-arrow${disabled ? ' is-disabled' : ''}`}
    >
      {children}
    </motion.button>
  );
}

function Indicator({
  isActive,
  autoDelay,
  onClick,
}: {
  isActive: boolean;
  autoDelay: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`ac-carousel-dot${isActive ? ' is-active' : ''}`}
      aria-current={isActive ? 'true' : undefined}
    >
      {isActive && (
        <motion.div
          key={`prog-${autoDelay}`}
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: autoDelay / 1000, ease: 'linear' }}
          className="ac-carousel-progress"
        />
      )}
    </motion.button>
  );
}

export default CarouselNavigator;
