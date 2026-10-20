import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { type ComponentProps } from 'react';

import { useTheme } from '../../lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const tabs: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: '今天', icon: 'sunny-outline' },
  { name: 'calendar', title: '日历', icon: 'calendar-outline' },
  { name: 'book', title: '生活簿', icon: 'book-outline' },
  { name: 'home', title: '家中', icon: 'home-outline' },
  { name: 'me', title: '我的', icon: 'person-outline' },
];

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.actionPrimary,
        tabBarInactiveTintColor: theme.color.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.borderDefault,
        },
        sceneStyle: { backgroundColor: theme.color.canvas },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={tab.icon} color={color} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
