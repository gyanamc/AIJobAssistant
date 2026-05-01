import React, { useRef } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolate,
  interpolateColor,
  SharedValue,
} from 'react-native-reanimated';
import { C } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;
const AUTO_APPLY_THRESHOLD = 80;

interface Props<T> {
  cards: T[];
  renderCard: (card: T, index: number) => React.ReactNode;
  onSwipedRight: (index: number) => void;
  onSwipedLeft: (index: number) => void;
  disabled?: boolean;
  keyExtractor?: (card: T, index: number) => string;
}

function SwipeCard<T>({
  card,
  index,
  isTop,
  renderCard,
  onSwipedRight,
  onSwipedLeft,
  disabled,
  activeTranslateX,
}: {
  card: T;
  index: number;
  isTop: boolean;
  renderCard: (card: T, index: number) => React.ReactNode;
  onSwipedRight: (index: number) => void;
  onSwipedLeft: (index: number) => void;
  disabled?: boolean;
  activeTranslateX: SharedValue<number>;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Use a shared value for isTop so the worklet always reads the latest value
  const isTopSV = useSharedValue(isTop);
  const disabledSV = useSharedValue(disabled ?? false);

  // Keep shared values in sync with props
  React.useEffect(() => { isTopSV.value = isTop; }, [isTop]);
  React.useEffect(() => { disabledSV.value = disabled ?? false; }, [disabled]);

  // Reset position when this card becomes the new top card
  React.useEffect(() => {
    if (isTop) {
      translateX.value = 0;
      translateY.value = 0;
    }
  }, [isTop]);

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onActive: (event) => {
      if (!isTopSV.value || disabledSV.value) return;
      translateX.value = event.translationX;
      translateY.value = event.translationY * 0.15;
      activeTranslateX.value = event.translationX;
    },
    onEnd: (event) => {
      if (!isTopSV.value || disabledSV.value) return;
      if (event.translationX > SWIPE_THRESHOLD) {
        translateX.value = withTiming(SCREEN_WIDTH * 1.5, { duration: 240 });
        activeTranslateX.value = withTiming(0, { duration: 240 });
        runOnJS(onSwipedRight)(index);
      } else if (event.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH * 1.5, { duration: 240 });
        activeTranslateX.value = withTiming(0, { duration: 240 });
        runOnJS(onSwipedLeft)(index);
      } else {
        translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
        translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
        activeTranslateX.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
      [-12, 0, 12],
      Extrapolate.CLAMP,
    );
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  // Overlay opacities — fade in only after 20% drag
  const applyOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [20, SWIPE_THRESHOLD * 0.7], [0, 1], Extrapolate.CLAMP),
  }));

  const skipOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-20, -SWIPE_THRESHOLD * 0.7], [0, 1], Extrapolate.CLAMP),
  }));

  // Smooth Tinder transition for the card *below* the top card
  const backCardStyle = useAnimatedStyle(() => {
    // If this is the top card, the activeTranslateX will fade IT out slightly
    if (isTop) {
      return {
        opacity: interpolate(Math.abs(translateX.value), [0, SCREEN_WIDTH], [1, 0.5], Extrapolate.CLAMP),
        transform: [{ scale: 1 }],
      };
    }
    // If it's a background card, it scales up and fades in based on the top card's drag
    const progress = Math.min(Math.abs(activeTranslateX.value) / SWIPE_THRESHOLD, 1);
    return {
      transform: [{ scale: interpolate(progress, [0, 1], [0.95, 1], Extrapolate.CLAMP) }],
      opacity: interpolate(progress, [0, 1], [0.5, 1], Extrapolate.CLAMP),
    };
  });

  // Determine if it's an auto-apply scenario
  const isAutoApply = ((card as any)?.match_score ?? 0) >= AUTO_APPLY_THRESHOLD;

  return (
    <PanGestureHandler onGestureEvent={gestureHandler} enabled={isTop && !disabled}>
      <Animated.View style={[styles.cardContainer, animatedStyle, backCardStyle]}>
        {/* APPLY / AUTO-APPLY overlay */}
        <Animated.View style={[styles.overlay, isAutoApply ? styles.autoApplyOverlay : styles.applyOverlay, applyOpacity]}>
          <Animated.Text style={isAutoApply ? styles.autoApplyLabel : styles.applyLabel}>
            {isAutoApply ? 'AUTO-APPLY ⚡️' : 'APPLY'}
          </Animated.Text>
        </Animated.View>
        {/* SKIP overlay */}
        <Animated.View style={[styles.overlay, styles.skipOverlay, skipOpacity]}>
          <Animated.Text style={styles.skipLabel}>SKIP</Animated.Text>
        </Animated.View>
        {renderCard(card, index)}
      </Animated.View>
    </PanGestureHandler>
  );
}

export default function SwipeDeck<T>({
  cards,
  renderCard,
  onSwipedRight,
  onSwipedLeft,
  disabled,
}: Props<T>) {
  const activeTranslateX = useSharedValue(0);

  // Top card for dynamic background logic
  const topCard = cards[0] as any;
  const isTopAutoApply = (topCard?.match_score ?? 0) >= AUTO_APPLY_THRESHOLD;

  const backgroundStyle = useAnimatedStyle(() => {
    const rightColor = isTopAutoApply ? 'rgba(59, 130, 246, 0.25)' : 'rgba(0, 200, 150, 0.18)'; // Blue for AI auto-apply, Green for manual apply
    return {
      backgroundColor: interpolateColor(
        activeTranslateX.value,
        [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD],
        ['rgba(255, 59, 48, 0.18)', 'transparent', rightColor],
      ),
    };
  });

  return (
    <View style={styles.deckWrapper}>
      <Animated.View pointerEvents="none" style={[styles.fullScreenBackground, backgroundStyle]} />
      <View style={styles.deck}>
        {cards.slice(0, 3).map((card, i) => (
          <SwipeCard
            key={(card as any)?.id ?? i}
            card={card}
            index={i}
            isTop={i === 0}
            renderCard={renderCard}
            onSwipedRight={onSwipedRight}
            onSwipedLeft={onSwipedLeft}
            disabled={disabled}
            activeTranslateX={activeTranslateX}
          />
        )).reverse()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  deckWrapper:          { flex: 1, position: 'relative' },
  fullScreenBackground: { ...StyleSheet.absoluteFillObject, zIndex: -1 },
  deck:                 { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardContainer:        { position: 'absolute', width: SCREEN_WIDTH - 32 },
  overlay: {
    position: 'absolute',
    top: 18,
    zIndex: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 2,
  },
  applyOverlay: {
    left: 18,
    borderColor: C.accent,
    backgroundColor: C.accentDim,
  },
  skipOverlay: {
    right: 18,
    borderColor: C.red,
    backgroundColor: C.redDim,
  },
  applyLabel: {
    color: C.accent,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  autoApplyOverlay: {
    left: 18,
    borderColor: '#3B82F6', // Vibrant blue for AI
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  autoApplyLabel: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  skipLabel: {
    color: C.red,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});
