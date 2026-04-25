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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;

interface Props<T> {
  cards: T[];
  renderCard: (card: T, index: number) => React.ReactNode;
  onSwipedRight: (index: number) => void;
  onSwipedLeft: (index: number) => void;
  disabled?: boolean;
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

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onActive: (event) => {
      if (!isTop || disabled) return;
      translateX.value = event.translationX;
      translateY.value = event.translationY * 0.2;
      activeTranslateX.value = event.translationX;
    },
    onEnd: (event) => {
      if (!isTop || disabled) return;
      if (event.translationX > SWIPE_THRESHOLD) {
        translateX.value = withTiming(SCREEN_WIDTH * 1.5, { duration: 250 });
        activeTranslateX.value = withTiming(0, { duration: 250 });
        runOnJS(onSwipedRight)(index);
      } else if (event.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH * 1.5, { duration: 250 });
        activeTranslateX.value = withTiming(0, { duration: 250 });
        runOnJS(onSwipedLeft)(index);
      } else {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        activeTranslateX.value = withSpring(0);
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
      [-15, 0, 15],
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

  const applyOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolate.CLAMP),
  }));

  const skipOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolate.CLAMP),
  }));

  const scale = useAnimatedStyle(() => ({
    transform: [{ scale: isTop ? 1 : 0.95 }],
    opacity: withTiming(isTop ? 1 : 0.85, { duration: 200 }),
  }));

  return (
    <PanGestureHandler onGestureEvent={gestureHandler} enabled={isTop && !disabled}>
      <Animated.View style={[styles.cardContainer, animatedStyle, !isTop && scale]}>
        {/* APPLY overlay */}
        <Animated.View style={[styles.overlay, styles.applyOverlay, applyOpacity]}>
          <Animated.Text style={styles.applyLabel}>APPLY</Animated.Text>
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
  // Shared state connecting the active swipe translation to the screen background
  const activeTranslateX = useSharedValue(0);

  const backgroundStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: interpolateColor(
        activeTranslateX.value,
        [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD],
        ['rgba(239, 68, 68, 0.3)', 'transparent', 'rgba(34, 197, 94, 0.3)']
      ),
    };
  });

  return (
    <View style={styles.deckWrapper}>
      <Animated.View pointerEvents="none" style={[styles.fullScreenBackground, backgroundStyle]} />
      <View style={styles.deck}>
        {cards.slice(0, 3).map((card, i) => (
          <SwipeCard
            key={i}
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
  deckWrapper: { flex: 1, position: 'relative' },
  fullScreenBackground: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  deck: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardContainer: { position: 'absolute', width: SCREEN_WIDTH - 32 },
  overlay: { position: 'absolute', top: 20, zIndex: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 3 },
  applyOverlay: { left: 20, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)' },
  skipOverlay: { right: 20, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)' },
  applyLabel: { color: '#22c55e', fontSize: 24, fontWeight: '800' },
  skipLabel: { color: '#ef4444', fontSize: 24, fontWeight: '800' },
});
