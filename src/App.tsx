import { useState, useEffect, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Trash2, 
  Activity, 
  Utensils, 
  Info, 
  ChevronRight, 
  Sparkles,
  Loader2,
  AlertCircle,
  Calendar as CalendarIcon,
  User,
  TrendingUp,
  ChevronLeft,
  CheckCircle2,
  LogIn,
  LogOut,
  BookOpen,
  Moon,
  Sun,
  Droplets,
  Stethoscope,
  Camera,
  FileText,
  Save,
  Mic,
  MicOff,
  History,
  Clock
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart,
  Pie,
  AreaChart,
  Area,
  Line
} from 'recharts';
import { 
  analyzeFood, 
  analyzeFoodImage,
  analyzeMedicalDocument,
  getNutrientRecommendations, 
  calculatePersonalizedTargets,
  getCanadaFoodGuideSummary,
  type FoodAnalysis, 
  type NutrientData,
  type UserProfile 
} from './services/geminiService';
import Markdown from 'react-markdown';

// Firebase Imports
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  orderBy, 
  addDoc, 
  deleteDoc, 
  getDocFromServer 
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

const DEFAULT_TARGETS: NutrientData = {
  calories: 2000,
  protein: 50,
  carbs: 275,
  fat: 78,
  fiber: 28,
  vitaminA: 100,
  vitaminC: 100,
  calcium: 100,
  iron: 100,
};

interface LogEntry extends FoodAnalysis {
  id: string;
  timestamp: number;
  symptoms?: string[];
  imageUrl?: string;
}

interface WaterLog {
  id: string;
  amount: number;
  timestamp: number;
}

interface Recipe extends FoodAnalysis {
  id: string;
}

type ViewMode = 'daily' | 'trends' | 'profile' | 'guide' | 'recipes' | 'report';
type TrendPeriod = 'weekly' | 'monthly' | 'yearly';

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Database Error: ${parsedError.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Oops!</h2>
            <p className="text-slate-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function NutriTrackApp() {
  // Auth State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // App State
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('weekly');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [profile, setProfile] = useState<UserProfile>({ 
    age: 30, 
    gender: 'male',
    dietaryRestrictions: [],
    allergies: [],
    activityLevel: 'moderate',
    medicalConditions: [],
    bloodTestSummary: ''
  });
  const [targets, setTargets] = useState<NutrientData>(DEFAULT_TARGETS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [waterLogs, setWaterLogs] = useState<WaterLog[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  const [foodInput, setFoodInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recommendations, setRecommendations] = useState<string>('');
  const [isRecLoading, setIsRecLoading] = useState(false);
  const [foodGuide, setFoodGuide] = useState<string>('');
  const [isGuideLoading, setIsGuideLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dark Mode Effect
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Profile
  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));
    return () => unsubscribe();
  }, [user]);

  // Firestore Sync: Targets
  useEffect(() => {
    if (!user) return;
    const targetDocRef = doc(db, 'users', user.uid, 'targets', 'daily');
    const unsubscribe = onSnapshot(targetDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setTargets(docSnap.data() as NutrientData);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/targets/daily`));
    return () => unsubscribe();
  }, [user]);

  // Firestore Sync: Logs
  useEffect(() => {
    if (!user) return;
    const logsColRef = collection(db, 'users', user.uid, 'logs');
    const q = query(logsColRef, orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnap) => {
      const fetchedLogs: LogEntry[] = [];
      querySnap.forEach((doc) => {
        fetchedLogs.push({ id: doc.id, ...doc.data() } as LogEntry);
      });
      setLogs(fetchedLogs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/logs`));
    return () => unsubscribe();
  }, [user]);

  // Firestore Sync: Water
  useEffect(() => {
    if (!user) return;
    const waterColRef = collection(db, 'users', user.uid, 'water');
    const q = query(waterColRef, orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnap) => {
      const fetched: WaterLog[] = [];
      querySnap.forEach((doc) => {
        fetched.push({ id: doc.id, ...doc.data() } as WaterLog);
      });
      setWaterLogs(fetched);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/water`));
    return () => unsubscribe();
  }, [user]);

  // Filter logs for selected date
  const dailyLogs = useMemo(() => {
    return logs.filter(log => new Date(log.timestamp).toISOString().split('T')[0] === selectedDate);
  }, [logs, selectedDate]);

  const dailyWater = useMemo(() => {
    return waterLogs
      .filter(log => new Date(log.timestamp).toISOString().split('T')[0] === selectedDate)
      .reduce((acc, log) => acc + log.amount, 0);
  }, [waterLogs, selectedDate]);

  // Calculate totals for selected date
  const totals = useMemo(() => {
    return dailyLogs.reduce((acc, log) => ({
      calories: acc.calories + log.nutrients.calories,
      protein: acc.protein + log.nutrients.protein,
      carbs: acc.carbs + log.nutrients.carbs,
      fat: acc.fat + log.nutrients.fat,
      fiber: acc.fiber + log.nutrients.fiber,
      vitaminA: acc.vitaminA + log.nutrients.vitaminA,
      vitaminC: acc.vitaminC + log.nutrients.vitaminC,
      calcium: acc.calcium + log.nutrients.calcium,
      iron: acc.iron + log.nutrients.iron,
    }), {
      calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
      vitaminA: 0, vitaminC: 0, calcium: 0, iron: 0
    });
  }, [dailyLogs]);

  // Trends Data Aggregation
  const trendsData = useMemo(() => {
    const now = new Date();
    let daysToLookBack = 7;
    if (trendPeriod === 'monthly') daysToLookBack = 30;
    if (trendPeriod === 'yearly') daysToLookBack = 365;

    const data = [];
    for (let i = daysToLookBack - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const dayLogs = logs.filter(log => new Date(log.timestamp).toISOString().split('T')[0] === dateStr);
      const dayTotal = dayLogs.reduce((acc, log) => acc + log.nutrients.calories, 0);
      
      data.push({
        date: dateStr,
        displayDate: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        calories: dayTotal,
        target: targets.calories
      });
    }
    return data;
  }, [logs, trendPeriod, targets.calories]);

  // Weekly Summary Calculation (Last 7 Days)
  const weeklySummary = useMemo(() => {
    const now = new Date();
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      last7Days.push(d.toISOString().split('T')[0]);
    }

    const weeklyLogs = logs.filter(log => {
      const logDate = new Date(log.timestamp).toISOString().split('T')[0];
      return last7Days.includes(logDate);
    });

    const totals = weeklyLogs.reduce((acc, log) => ({
      calories: acc.calories + log.nutrients.calories,
      protein: acc.protein + log.nutrients.protein,
      carbs: acc.carbs + log.nutrients.carbs,
      fat: acc.fat + log.nutrients.fat,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    const daysMetTarget = last7Days.filter(dateStr => {
      const dayLogs = logs.filter(log => new Date(log.timestamp).toISOString().split('T')[0] === dateStr);
      const dayTotal = dayLogs.reduce((acc, log) => acc + log.nutrients.calories, 0);
      const ratio = dayTotal / targets.calories;
      return ratio >= 0.8 && ratio <= 1.2;
    }).length;

    return {
      avgCalories: totals.calories / 7,
      totalProtein: totals.protein,
      totalCarbs: totals.carbs,
      totalFat: totals.fat,
      percentMet: (daysMetTarget / 7) * 100
    };
  }, [logs, targets.calories]);

  // Update recommendations
  useEffect(() => {
    if (dailyLogs.length > 0) {
      const timer = setTimeout(() => {
        fetchRecommendations();
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setRecommendations('');
    }
  }, [dailyLogs]);

  // Fetch Food Guide Summary
  useEffect(() => {
    if (viewMode === 'guide' && !foodGuide) {
      fetchFoodGuide();
    }
  }, [viewMode]);

  const fetchFoodGuide = async () => {
    setIsGuideLoading(true);
    try {
      const guide = await getCanadaFoodGuideSummary();
      setFoodGuide(guide);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGuideLoading(false);
    }
  };

  const fetchRecommendations = async () => {
    setIsRecLoading(true);
    try {
      const recs = await getNutrientRecommendations(totals, profile);
      setRecommendations(recs);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRecLoading(false);
    }
  };

  const updateTargets = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const newTargets = await calculatePersonalizedTargets(profile);
      const targetDocRef = doc(db, 'users', user.uid, 'targets', 'daily');
      await setDoc(targetDocRef, newTargets);
      setTargets(newTargets);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/targets/daily`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddFood = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foodInput.trim() || !user) return;

    setIsLoading(true);
    setError(null);
    try {
      const analysis = await analyzeFood(foodInput, profile);
      const logData = {
        name: analysis.name,
        nutrients: analysis.nutrients,
        warnings: analysis.warnings || [],
        timestamp: new Date(selectedDate + 'T' + new Date().toLocaleTimeString('en-US', { hour12: false })).getTime(),
      };
      const logsColRef = collection(db, 'users', user.uid, 'logs');
      await addDoc(logsColRef, logData);
      setFoodInput('');
    } catch (err) {
      setError('Failed to analyze food. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsLoading(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const analysis = await analyzeFoodImage(base64, profile);
        const logData = {
          name: analysis.name,
          nutrients: analysis.nutrients,
          warnings: analysis.warnings || [],
          timestamp: new Date(selectedDate + 'T' + new Date().toLocaleTimeString('en-US', { hour12: false })).getTime(),
        };
        const logsColRef = collection(db, 'users', user.uid, 'logs');
        await addDoc(logsColRef, logData);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Failed to analyze image. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMedicalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsLoading(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const summary = await analyzeMedicalDocument(base64);
        handleProfileUpdate({ ...profile, bloodTestSummary: summary });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Failed to analyze medical document. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const addWater = async (amount: number) => {
    if (!user) return;
    try {
      const waterColRef = collection(db, 'users', user.uid, 'water');
      await addDoc(waterColRef, {
        amount,
        timestamp: new Date(selectedDate + 'T' + new Date().toLocaleTimeString('en-US', { hour12: false })).getTime(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/water`);
    }
  };

  const addSymptom = async (logId: string, symptom: string) => {
    if (!user) return;
    const log = logs.find(l => l.id === logId);
    if (!log) return;
    
    const newSymptoms = [...(log.symptoms || []), symptom];
    try {
      const logDocRef = doc(db, 'users', user.uid, 'logs', logId);
      await setDoc(logDocRef, { symptoms: newSymptoms }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/logs/${logId}`);
    }
  };

  const removeEntry = async (id: string) => {
    if (!user) return;
    try {
      const logDocRef = doc(db, 'users', user.uid, 'logs', id);
      await deleteDoc(logDocRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/logs/${id}`);
    }
  };

  // Firestore Sync: Recipes
  useEffect(() => {
    if (!user) return;
    const recipesColRef = collection(db, 'users', user.uid, 'recipes');
    const unsubscribe = onSnapshot(recipesColRef, (querySnap) => {
      const fetched: Recipe[] = [];
      querySnap.forEach((doc) => {
        fetched.push({ id: doc.id, ...doc.data() } as Recipe);
      });
      setRecipes(fetched);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/recipes`));
    return () => unsubscribe();
  }, [user]);

  const saveAsRecipe = async (logId: string) => {
    if (!user) return;
    const log = logs.find(l => l.id === logId);
    if (!log) return;

    try {
      const recipesColRef = collection(db, 'users', user.uid, 'recipes');
      await addDoc(recipesColRef, {
        name: log.name,
        nutrients: log.nutrients
      });
      alert("Saved as recipe!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/recipes`);
    }
  };

  const logRecipe = async (recipe: Recipe) => {
    if (!user) return;
    try {
      const logData = {
        name: recipe.name,
        nutrients: recipe.nutrients,
        timestamp: new Date(selectedDate + 'T' + new Date().toLocaleTimeString('en-US', { hour12: false })).getTime(),
      };
      const logsColRef = collection(db, 'users', user.uid, 'logs');
      await addDoc(logsColRef, logData);
      setViewMode('daily');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/logs`);
    }
  };

  const handleProfileUpdate = async (newProfile: UserProfile) => {
    if (!user) return;
    setProfile(newProfile);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, newProfile, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const startVoiceCommand = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setFoodInput(transcript);
    };
    recognition.start();
  };

  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Sign in error:", err);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setLogs([]);
      setProfile({ age: 30, gender: 'male' });
      setTargets(DEFAULT_TARGETS);
    } catch (err) {
      console.error("Sign out error:", err);
    }
  };

  const chartData = [
    { name: 'Protein', value: totals.protein, target: targets.protein, unit: 'g' },
    { name: 'Carbs', value: totals.carbs, target: targets.carbs, unit: 'g' },
    { name: 'Fat', value: totals.fat, target: targets.fat, unit: 'g' },
    { name: 'Fiber', value: totals.fiber, target: targets.fiber, unit: 'g' },
  ];

  const micronutrientData = [
    { name: 'Vit A', value: totals.vitaminA, target: 100 },
    { name: 'Vit C', value: totals.vitaminC, target: 100 },
    { name: 'Calcium', value: totals.calcium, target: 100 },
    { name: 'Iron', value: totals.iron, target: 100 },
  ];

  const macroPieData = [
    { name: 'Protein', value: totals.protein * 4 },
    { name: 'Carbs', value: totals.carbs * 4 },
    { name: 'Fat', value: totals.fat * 9 },
  ].filter(d => d.value > 0);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  const isMeetingTarget = (current: number, target: number) => {
    const ratio = current / target;
    return ratio >= 0.8 && ratio <= 1.2;
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-12 h-12 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-12 rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full text-center space-y-8">
          <div className="bg-emerald-500 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <Utensils className="text-white w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">NutriTrack AI</h1>
            <p className="text-slate-500">Your personal AI-powered nutrition companion.</p>
          </div>
          <button 
            onClick={handleSignIn}
            className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-xl"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
          <p className="text-xs text-slate-400">
            Securely save your logs and access them from any device.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setViewMode('daily')}>
            <div className="bg-emerald-500 p-2 rounded-lg">
              <Utensils className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">NutriTrack AI</h1>
          </div>
          
          <nav className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setViewMode('daily')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'daily' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Daily Log
            </button>
            <button 
              onClick={() => setViewMode('trends')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'trends' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Trends
            </button>
            <button 
              onClick={() => setViewMode('guide')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'guide' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Food Guide
            </button>
            <button 
              onClick={() => setViewMode('recipes')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'recipes' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Recipes
            </button>
            <button 
              onClick={() => setViewMode('report')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'report' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Report
            </button>
            <button 
              onClick={() => setViewMode('profile')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'profile' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Profile
            </button>
          </nav>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-600" />}
            </button>
            <div className="hidden sm:flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              <Activity className="w-4 h-4 text-emerald-500" />
              <span>{totals.calories.toFixed(0)} / {targets.calories.toFixed(0)} kcal</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setViewMode('profile')}
                className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"
              >
                <User className="w-5 h-5 text-slate-600" />
              </button>
              <button 
                onClick={handleSignOut}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {viewMode === 'daily' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Input & Logs */}
            <div className="lg:col-span-5 space-y-6">
              {/* Date Selector */}
              <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <button 
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setDate(d.getDate() - 1);
                    setSelectedDate(d.toISOString().split('T')[0]);
                  }}
                  className="p-2 hover:bg-slate-50 rounded-lg"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2 font-semibold">
                  <CalendarIcon className="w-4 h-4 text-emerald-500" />
                  {new Date(selectedDate).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
                <button 
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setDate(d.getDate() + 1);
                    setSelectedDate(d.toISOString().split('T')[0]);
                  }}
                  className="p-2 hover:bg-slate-50 rounded-lg"
                >
                  <ChevronRight className="w-5 h-5 rotate-0" />
                </button>
              </div>

              <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-emerald-500" />
                  Log Your Meal
                </h2>
                <form onSubmit={handleAddFood} className="space-y-4">
                  <div className="relative">
                    <input
                      type="text"
                      value={foodInput}
                      onChange={(e) => setFoodInput(e.target.value)}
                      placeholder="e.g., 2 scrambled eggs with toast"
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all dark:text-white"
                      disabled={isLoading}
                    />
                    <div className="absolute right-2 top-2 bottom-2 flex gap-2">
                      <button
                        type="button"
                        onClick={startVoiceCommand}
                        className={`p-2 rounded-lg transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                      >
                        {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      </button>
                      <label className="p-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer transition-colors">
                        <Camera className="w-5 h-5" />
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </label>
                      <button
                        type="submit"
                        disabled={isLoading || !foodInput.trim()}
                        className="px-4 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                      >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analyze'}
                      </button>
                    </div>
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}
                </form>
              </section>

              {/* Water Tracker */}
              <section className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                    <Droplets className="w-5 h-5 text-blue-500" />
                    Hydration
                  </h2>
                  <span className="text-sm font-medium text-blue-500">{dailyWater} / 2500 ml</span>
                </div>
                <div className="flex gap-2">
                  {[250, 500, 750].map(amount => (
                    <button
                      key={amount}
                      onClick={() => addWater(amount)}
                      className="flex-1 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                    >
                      +{amount}ml
                    </button>
                  ))}
                </div>
                <div className="mt-4 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (dailyWater / 2500) * 100)}%` }}
                    className="h-full bg-blue-500"
                  />
                </div>
                <div className="space-y-3 mt-4">
                  {waterLogs.filter(w => new Date(w.timestamp).toISOString().split('T')[0] === selectedDate).map((w, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100/50 dark:border-blue-800/50">
                      <div className="flex items-center gap-2">
                        <Droplets className="w-4 h-4 text-blue-500" />
                        <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{w.amount}ml</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-blue-400" />
                        <span className="text-[10px] font-medium text-blue-400">
                          {new Date(w.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center justify-between">
                  Meal History
                  <span className="text-sm font-normal text-slate-400">{dailyLogs.length} entries</span>
                </h2>
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {dailyLogs.length === 0 ? (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-slate-400"
                      >
                        No meals logged for this day.
                      </motion.div>
                    ) : (
                      dailyLogs.map((log) => (
                        <motion.div
                          key={log.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm group hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h3 className="font-medium text-slate-800 dark:text-slate-100 capitalize">{log.name}</h3>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <p className="text-xs text-slate-400 font-medium">
                                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveAsRecipe(log.id)}
                                className="p-1.5 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                title="Save as Recipe"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  const symptom = prompt("How did you feel after this meal? (e.g., Bloated, Energetic)");
                                  if (symptom) addSymptom(log.id, symptom);
                                }}
                                className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                title="Add Symptom"
                              >
                                <Stethoscope className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => removeEntry(log.id)}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          {log.warnings && log.warnings.length > 0 && (
                            <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-lg">
                              {log.warnings.map((w, i) => (
                                <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" /> {w}
                                </p>
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                              <p className="text-[10px] text-slate-400 uppercase font-bold">Cals</p>
                              <p className="text-sm font-semibold dark:text-slate-200">{log.nutrients.calories}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                              <p className="text-[10px] text-slate-400 uppercase font-bold">Prot</p>
                              <p className="text-sm font-semibold dark:text-slate-200">{log.nutrients.protein}g</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                              <p className="text-[10px] text-slate-400 uppercase font-bold">Carb</p>
                              <p className="text-sm font-semibold dark:text-slate-200">{log.nutrients.carbs}g</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                              <p className="text-[10px] text-slate-400 uppercase font-bold">Fat</p>
                              <p className="text-sm font-semibold dark:text-slate-200">{log.nutrients.fat}g</p>
                            </div>
                          </div>

                          {log.symptoms && log.symptoms.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1">
                              {log.symptoms.map((s, i) => (
                                <span key={i} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] font-bold rounded-full border border-blue-100 dark:border-blue-800">
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </section>
            </div>

            {/* Right Column: Dashboard & Recs */}
            <div className="lg:col-span-7 space-y-8">
              {/* Macro Dashboard */}
              <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-500" />
                    Daily Progress
                  </h2>
                  <div className="flex items-center gap-2">
                    {isMeetingTarget(totals.calories, targets.calories) ? (
                      <div className="flex items-center gap-1 text-emerald-500 text-xs font-bold bg-emerald-50 px-2 py-1 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Target Met
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-amber-500 text-xs font-bold bg-amber-50 px-2 py-1 rounded-full">
                        <AlertCircle className="w-3 h-3" /> Off Track
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                        <XAxis type="number" hide />
                        <YAxis 
                          dataKey="name" 
                          type="category" 
                          axisLine={false} 
                          tickLine={false} 
                          width={60}
                          tick={{ fontSize: 12, fontWeight: 500 }}
                        />
                        <Tooltip 
                          cursor={{ fill: 'transparent' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-3 shadow-xl border border-slate-100 rounded-lg text-xs">
                                  <p className="font-bold mb-1">{data.name}</p>
                                  <p className="text-slate-500">Current: {data.value.toFixed(1)}{data.unit}</p>
                                  <p className="text-slate-500">Target: {data.target.toFixed(1)}{data.unit}</p>
                                  <p className="text-emerald-500 font-bold mt-1">
                                    {Math.min(100, (data.value / data.target) * 100).toFixed(0)}% of target
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="target" fill="#f1f5f9" radius={[0, 4, 4, 0]} barSize={24} />
                        <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-col justify-center items-center">
                    <div className="h-48 w-48 relative">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={macroPieData}
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {macroPieData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <p className="text-2xl font-bold">{totals.calories.toFixed(0)}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest text-center">Total Cals</p>
                      </div>
                    </div>
                    <div className="flex gap-4 mt-4">
                      {macroPieData.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-1.5 text-xs font-medium">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i] }}></div>
                          {d.name}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* Micronutrients */}
              <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <Info className="w-5 h-5 text-purple-500" />
                  Micronutrients (% Daily Value)
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {micronutrientData.map((micro) => (
                    <div key={micro.name} className="space-y-2">
                      <div className="flex justify-between text-xs font-medium">
                        <span>{micro.name}</span>
                        <span className={micro.value >= 100 ? 'text-emerald-500' : 'text-slate-400'}>
                          {micro.value.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, micro.value)}%` }}
                          className={`h-full rounded-full ${micro.value >= 100 ? 'bg-emerald-500' : 'bg-purple-500'}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* AI Recommendations */}
              <section className="bg-emerald-900 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Sparkles className="w-32 h-32" />
                </div>
                
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="bg-emerald-400/20 p-2 rounded-lg">
                      <Sparkles className="w-5 h-5 text-emerald-400" />
                    </div>
                    <h2 className="text-xl font-bold">Nutritional Insights</h2>
                  </div>

                  {isRecLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                      <p className="text-emerald-200 text-sm animate-pulse">Analyzing your nutrient gaps...</p>
                    </div>
                  ) : recommendations ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <Markdown>{recommendations}</Markdown>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-emerald-200/60 italic">
                        Log some food to get personalized nutritional advice.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {viewMode === 'trends' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-emerald-500" />
                Nutritional Trends
              </h2>
              <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                {(['weekly', 'monthly', 'yearly'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setTrendPeriod(p)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${trendPeriod === p ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Weekly Summary Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-700">Last 7 Days Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Daily Calories</p>
                  <p className="text-2xl font-bold text-slate-900">{weeklySummary.avgCalories.toFixed(0)} <span className="text-sm font-normal text-slate-500">kcal</span></p>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Protein</p>
                  <p className="text-2xl font-bold text-blue-600">{weeklySummary.totalProtein.toFixed(0)} <span className="text-sm font-normal text-slate-500">g</span></p>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Carbs</p>
                  <p className="text-2xl font-bold text-emerald-600">{weeklySummary.totalCarbs.toFixed(0)} <span className="text-sm font-normal text-slate-500">g</span></p>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Fat</p>
                  <p className="text-2xl font-bold text-amber-600">{weeklySummary.totalFat.toFixed(0)} <span className="text-sm font-normal text-slate-500">g</span></p>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-emerald-100 p-3 rounded-xl">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Weekly Target Consistency</h3>
                    <p className="text-sm text-slate-500">You met your calorie target on {weeklySummary.percentMet.toFixed(0)}% of the last 7 days.</p>
                  </div>
                </div>
                <div className="text-3xl font-black text-emerald-500">
                  {weeklySummary.percentMet.toFixed(0)}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-semibold mb-6">Calorie Intake History</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart 
                      data={trendsData}
                      onClick={(data: any) => {
                        if (data && data.activePayload) {
                          setSelectedDate(data.activePayload[0].payload.date);
                          setViewMode('daily');
                        }
                      }}
                    >
                      <defs>
                        <linearGradient id="colorCal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Area type="monotone" dataKey="calories" stroke="#10b981" fillOpacity={1} fill="url(#colorCal)" strokeWidth={3} />
                      <Line type="monotone" dataKey="target" stroke="#cbd5e1" strokeDasharray="5 5" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4">Target Summary</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">Days Meeting Target</span>
                      <span className="font-bold text-emerald-500">
                        {trendsData.filter(d => isMeetingTarget(d.calories, d.target)).length} / {trendsData.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">Average Intake</span>
                      <span className="font-bold">
                        {(trendsData.reduce((acc, d) => acc + d.calories, 0) / trendsData.length).toFixed(0)} kcal
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-full" 
                        style={{ width: `${(trendsData.filter(d => isMeetingTarget(d.calories, d.target)).length / trendsData.length) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
                  <h3 className="text-emerald-800 font-bold mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Trend Insight
                  </h3>
                  <p className="text-sm text-emerald-700 leading-relaxed">
                    {trendsData.filter(d => d.calories > d.target * 1.2).length > 2 
                      ? "You've been consistently exceeding your calorie target. Consider logging more high-fiber foods to feel fuller longer."
                      : "Your intake has been stable. You're doing a great job maintaining consistency!"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'guide' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-bold flex items-center justify-center gap-3">
                <BookOpen className="w-8 h-8 text-emerald-500" />
                Canada's Food Guide
              </h2>
              <p className="text-slate-500 max-w-2xl mx-auto">
                Eat a variety of healthy foods each day. Healthy eating is more than the foods you eat. 
                It is also about where, when, why and how you eat.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                <h3 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4">Plate Proportions</h3>
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="bg-emerald-100 p-3 rounded-xl shrink-0">
                      <Utensils className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800">Half your plate</h4>
                      <p className="text-sm text-slate-600">Vegetables and fruits should make up 50% of your meal.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-amber-100 p-3 rounded-xl shrink-0">
                      <TrendingUp className="w-6 h-6 text-amber-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800">Quarter your plate</h4>
                      <p className="text-sm text-slate-600">Whole grain foods should make up 25% of your meal.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-blue-100 p-3 rounded-xl shrink-0">
                      <Activity className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800">Quarter your plate</h4>
                      <p className="text-sm text-slate-600">Protein foods should make up the remaining 25%.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-emerald-900 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Sparkles className="w-32 h-32" />
                </div>
                <div className="relative z-10">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    AI Guide Summary
                  </h3>
                  {isGuideLoading ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-4">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                      <p className="text-emerald-200 text-sm">Fetching latest guidelines...</p>
                    </div>
                  ) : (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <Markdown>{foodGuide}</Markdown>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-xl font-bold mb-6">Healthy Eating Habits</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <h4 className="font-bold text-slate-800 mb-2">Be Mindful</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">Take time to eat and notice when you are hungry and when you are full.</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <h4 className="font-bold text-slate-800 mb-2">Cook More Often</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">Cooking at home helps you rely less on highly processed foods.</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <h4 className="font-bold text-slate-800 mb-2">Enjoy Your Food</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">Healthy eating includes enjoying your food and the culture of eating.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'recipes' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <h2 className="text-2xl font-bold flex items-center gap-2 dark:text-white">
              <History className="w-6 h-6 text-emerald-500" />
              Your Saved Recipes
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {recipes.length === 0 ? (
                <div className="col-span-full text-center py-12 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
                  No recipes saved yet. Save a meal from your history to see it here!
                </div>
              ) : (
                recipes.map(recipe => (
                  <motion.div 
                    key={recipe.id}
                    whileHover={{ y: -5 }}
                    className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
                  >
                    <h3 className="text-lg font-bold capitalize dark:text-white">{recipe.name}</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-xl text-center">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Calories</p>
                        <p className="text-sm font-bold dark:text-slate-200">{recipe.nutrients.calories}</p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-xl text-center">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Protein</p>
                        <p className="text-sm font-bold dark:text-slate-200">{recipe.nutrients.protein}g</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => logRecipe(recipe)}
                      className="w-full py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Log Again
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        )}

        {viewMode === 'report' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-2 dark:text-white">
                <FileText className="w-6 h-6 text-emerald-500" />
                Health & Nutrition Report
              </h2>
              <button 
                onClick={() => window.print()}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> Export PDF
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-8 print:shadow-none print:border-none">
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">User Profile</h3>
                  <div className="space-y-2 text-slate-600 dark:text-slate-300">
                    <p><span className="font-bold">Age:</span> {profile.age}</p>
                    <p><span className="font-bold">Gender:</span> {profile.gender}</p>
                    <p><span className="font-bold">Activity:</span> {profile.activityLevel}</p>
                    <p><span className="font-bold">Diet:</span> {profile.dietaryRestrictions?.join(', ') || 'None'}</p>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Weekly Averages</h3>
                  <div className="space-y-2 text-slate-600 dark:text-slate-300">
                    <p><span className="font-bold">Calories:</span> {weeklySummary.avgCalories.toFixed(0)} kcal</p>
                    <p><span className="font-bold">Protein:</span> {(weeklySummary.totalProtein / 7).toFixed(1)} g</p>
                    <p><span className="font-bold">Carbs:</span> {(weeklySummary.totalCarbs / 7).toFixed(1)} g</p>
                    <p><span className="font-bold">Fat:</span> {(weeklySummary.totalFat / 7).toFixed(1)} g</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Symptom Correlations</h3>
                <div className="space-y-4">
                  {logs.filter(l => l.symptoms && l.symptoms.length > 0).slice(0, 5).map(log => (
                    <div key={log.id} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl flex justify-between items-center">
                      <div>
                        <p className="font-bold dark:text-white capitalize">{log.name}</p>
                        <p className="text-xs text-slate-500">{new Date(log.timestamp).toLocaleDateString()}</p>
                      </div>
                      <div className="flex gap-1">
                        {log.symptoms?.map(s => (
                          <span key={s} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold rounded-lg">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {logs.filter(l => l.symptoms && l.symptoms.length > 0).length === 0 && (
                    <p className="text-slate-400 italic text-sm">No symptoms logged yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'profile' && (
          <div className="max-w-2xl mx-auto space-y-8">
            <h2 className="text-2xl font-bold flex items-center gap-2 dark:text-white">
              <User className="w-6 h-6 text-emerald-500" />
              Your Profile
            </h2>
            
            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Age</label>
                  <input 
                    type="number" 
                    value={profile.age}
                    onChange={(e) => handleProfileUpdate({ ...profile, age: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:text-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Gender</label>
                  <select 
                    value={profile.gender}
                    onChange={(e) => handleProfileUpdate({ ...profile, gender: e.target.value as any })}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:text-white"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Activity Level</label>
                  <select 
                    value={profile.activityLevel}
                    onChange={(e) => handleProfileUpdate({ ...profile, activityLevel: e.target.value as any })}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:text-white"
                  >
                    <option value="sedentary">Sedentary</option>
                    <option value="light">Lightly Active</option>
                    <option value="moderate">Moderately Active</option>
                    <option value="active">Very Active</option>
                    <option value="very_active">Extra Active</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Dietary Restrictions</label>
                <input 
                  type="text" 
                  placeholder="e.g., Vegan, Keto (comma separated)"
                  value={profile.dietaryRestrictions?.join(', ')}
                  onChange={(e) => handleProfileUpdate({ ...profile, dietaryRestrictions: e.target.value.split(',').map(s => s.trim()) })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Allergies</label>
                <input 
                  type="text" 
                  placeholder="e.g., Peanuts, Dairy (comma separated)"
                  value={profile.allergies?.join(', ')}
                  onChange={(e) => handleProfileUpdate({ ...profile, allergies: e.target.value.split(',').map(s => s.trim()) })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Medical Conditions</label>
                <input 
                  type="text" 
                  placeholder="e.g., Diabetes, Hypertension (comma separated)"
                  value={profile.medicalConditions?.join(', ')}
                  onChange={(e) => handleProfileUpdate({ ...profile, medicalConditions: e.target.value.split(',').map(s => s.trim()) })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:text-white"
                />
              </div>

              <div className="space-y-4">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider block">Blood Test / Medical Records</label>
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Camera className="w-8 h-8 text-slate-400 mb-2" />
                      <p className="text-sm text-slate-500">Upload Blood Test Result (Image)</p>
                    </div>
                    <input type="file" accept="image/*" className="hidden" onChange={handleMedicalUpload} />
                  </label>
                  
                  {profile.bloodTestSummary && (
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-2xl">
                      <h4 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase mb-2">AI Summary of Results</h4>
                      <p className="text-sm text-slate-600 dark:text-slate-300 italic">{profile.bloodTestSummary}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100">
                <button 
                  onClick={updateTargets}
                  disabled={isLoading}
                  className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                  Update Personalized Targets
                </button>
                <p className="text-center text-xs text-slate-400 mt-4">
                  This will use AI to calculate optimal nutrient targets based on your profile.
                </p>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-bold mb-6">Current Daily Targets</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {Object.entries(targets).map(([key, value]) => (
                  <div key={key} className="bg-slate-50 p-4 rounded-2xl">
                    <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">{key}</p>
                    <p className="text-lg font-bold text-slate-700">{value.toFixed(0)}{key === 'calories' ? '' : (['protein', 'carbs', 'fat', 'fiber'].includes(key) ? 'g' : '%')}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-12 text-center text-slate-400 text-sm">
        <p>© 2026 NutriTrack AI • Powered by Gemini</p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <NutriTrackApp />
    </ErrorBoundary>
  );
}
