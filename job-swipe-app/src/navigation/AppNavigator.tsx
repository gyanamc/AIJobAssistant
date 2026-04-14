import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';
import { getItem, KEYS } from '../utils/storage';
import type { UserPreferences } from '../types';

// Screens
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
  HILReview: { job: any; coverLetter: string };
  Auth: { pendingJob?: any };
};

export type TabParamList = {
  Swipe: undefined;
  Applications: undefined;
  Profile: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<TabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
        tabBarActiveTintColor: '#22c55e',
        tabBarInactiveTintColor: '#64748b',
      }}
    >
      <Tab.Screen
        name="Swipe"
        component={SwipeDeckScreen}
        options={{ tabBarLabel: 'Jobs', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💼</Text> }}
      />
      <Tab.Screen
        name="Applications"
        component={ApplicationsScreen}
        options={{ tabBarLabel: 'Applied', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📋</Text> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: 'Profile', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👤</Text> }}
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
        screenOptions={{ headerShown: false, cardStyle: { backgroundColor: '#0f172a' } }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="JobDetail" component={JobDetailSheet} options={{ presentation: 'modal' }} />
        <Stack.Screen name="HILReview" component={HILReviewScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Auth" component={AuthScreen} options={{ presentation: 'modal' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
