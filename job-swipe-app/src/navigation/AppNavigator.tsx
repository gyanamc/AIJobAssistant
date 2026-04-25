import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';
import { getItem, KEYS } from '../utils/storage';
import type { UserPreferences } from '../types';
import { C, T, S } from '../theme';

import OnboardingScreen from '../screens/OnboardingScreen';
import SwipeDeckScreen from '../screens/SwipeDeckScreen';
import ApplicationsScreen from '../screens/ApplicationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import JobDetailSheet from '../screens/JobDetailSheet';
import HILReviewScreen from '../screens/HILReviewScreen';
import AuthScreen from '../screens/AuthScreen';

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  JobDetail: { job: any };
  HILReview: { job: any; autoApply: boolean };
  Auth: { pendingJob?: any };
};

export type TabParamList = {
  Swipe: undefined;
  Applications: undefined;
  Profile: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<TabParamList>();

function TabIcon({ label, glyph, color }: { label: string; glyph: string; color: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 16, color }}>{glyph}</Text>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.05)',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor:   C.accent,
        tabBarInactiveTintColor: C.textDim,
        tabBarLabelStyle: {
          fontSize: T.xs,
          fontWeight: T.semibold,
          letterSpacing: 0.3,
        },
      }}
    >
      <Tab.Screen
        name="Swipe"
        component={SwipeDeckScreen}
        options={{
          tabBarLabel: 'Jobs',
          tabBarIcon: ({ color }) => <TabIcon label="Jobs" glyph="◈" color={color} />,
        }}
      />
      <Tab.Screen
        name="Applications"
        component={ApplicationsScreen}
        options={{
          tabBarLabel: 'Applied',
          tabBarIcon: ({ color }) => <TabIcon label="Applied" glyph="◉" color={color} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => <TabIcon label="Profile" glyph="◎" color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const [initialRoute, setInitialRoute] = React.useState<'Onboarding' | 'Main' | null>(null);

  React.useEffect(() => {
    getItem<UserPreferences>(KEYS.PREFERENCES).then(prefs => {
      setInitialRoute(prefs?.onboarding_complete ? 'Main' : 'Onboarding');
    });
  }, []);

  if (!initialRoute) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false, cardStyle: { backgroundColor: C.bg } }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Main"       component={MainTabs} />
        <Stack.Screen name="JobDetail"  component={JobDetailSheet} options={{ presentation: 'modal' }} />
        <Stack.Screen name="HILReview"  component={HILReviewScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Auth"       component={AuthScreen}      options={{ presentation: 'modal' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
