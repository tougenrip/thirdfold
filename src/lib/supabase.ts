import { createClient } from '@supabase/supabase-js';
import { API_URL } from './api';

export const supabase = createClient(API_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
