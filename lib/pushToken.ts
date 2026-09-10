import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export async function registerForPushNotificationsAsync(userId: string) {
  if (!Device.isDevice) return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: '173bc4e7-d099-455f-b31a-c9d335a62fea',
  });

  await supabase
    .from('personel')
    .update({ expo_push_token: tokenData.data })
    .eq('id', userId);
}