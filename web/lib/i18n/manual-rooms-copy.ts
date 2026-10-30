/**
 * /manuals cascading filters: room names, doc types and filter chrome.
 * Order in row(): fa, es, fr, he, it, de, pt, ar.
 * Subtype labels (CT, MRI, ESU, …) are English-only for now.
 */
import type { PublicLocale } from './locales.ts';

type Loc = Exclude<PublicLocale, 'en'>;
function row(fa: string, es: string, fr: string, he: string, it: string, de: string, pt: string, ar: string): Record<Loc, string> {
  return { fa, es, fr, he, it, de, pt, ar };
}

export const MANUAL_ROOMS_STRINGS: Record<string, Record<Loc, string>> = {
  // Rooms
  'Imaging': row('تصویربرداری', 'Imagenología', 'Imagerie', 'הדמיה', 'Diagnostica per immagini', 'Bildgebung', 'Imagem', 'التصوير الطبي'),
  'Respiratory & Anesthesia': row('تنفسی و بیهوشی', 'Respiratorio y anestesia', 'Respiratoire et anesthésie', 'נשימה והרדמה', 'Respiratorio e anestesia', 'Beatmung & Anästhesie', 'Respiratório e anestesia', 'التنفس والتخدير'),
  'Monitoring & Diagnostics': row('پایش و تشخیص', 'Monitorización y diagnóstico', 'Monitorage et diagnostic', 'ניטור ואבחון', 'Monitoraggio e diagnostica', 'Monitoring & Diagnostik', 'Monitorização e diagnóstico', 'المراقبة والتشخيص'),
  'Infusion': row('انفوزیون', 'Infusión', 'Perfusion', 'עירוי', 'Infusione', 'Infusionstherapie', 'Infusão', 'التسريب'),
  'Surgical / OR': row('جراحی / اتاق عمل', 'Quirúrgico / quirófano', 'Chirurgie / bloc', 'כירורגיה / חדר ניתוח', 'Chirurgia / sala operatoria', 'Chirurgie / OP', 'Cirúrgico / centro cirúrgico', 'الجراحة / غرفة العمليات'),
  'Endoscopy & Video': row('آندوسکوپی و ویدیو', 'Endoscopia y video', 'Endoscopie et vidéo', 'אנדוסקופיה ווידאו', 'Endoscopia e video', 'Endoskopie & Video', 'Endoscopia e vídeo', 'التنظير والفيديو'),
  'Sterile Processing': row('استریل‌سازی', 'Esterilización', 'Stérilisation', 'עיקור', 'Sterilizzazione', 'Sterilgutaufbereitung', 'Esterilização', 'التعقيم'),
  'Lab': row('آزمایشگاه', 'Laboratorio', 'Laboratoire', 'מעבדה', 'Laboratorio', 'Labor', 'Laboratório', 'المختبر'),
  'Dental': row('دندانپزشکی', 'Odontología', 'Dentaire', 'רפואת שיניים', 'Odontoiatria', 'Zahnmedizin', 'Odontológico', 'طب الأسنان'),
  'Lasers & Energy': row('لیزر و انرژی', 'Láseres y energía', 'Lasers et énergie', 'לייזרים ואנרגיה', 'Laser ed energia', 'Laser & Energie', 'Lasers e energia', 'الليزر والطاقة'),
  'Neonatal': row('نوزادان', 'Neonatología', 'Néonatal', 'פגייה', 'Neonatale', 'Neonatologie', 'Neonatologia', 'حديثو الولادة'),
  'Dialysis': row('دیالیز', 'Diálisis', 'Dialyse', 'דיאליזה', 'Dialisi', 'Dialyse', 'Diálise', 'غسيل الكلى'),
  'Ophthalmic / ENT': row('چشم / گوش و حلق و بینی', 'Oftalmología / ORL', 'Ophtalmologie / ORL', 'עיניים / אא״ג', 'Oftalmologia / ORL', 'Augen / HNO', 'Oftalmologia / ORL', 'العيون / الأنف والأذن والحنجرة'),
  'Beds & Lifts': row('تخت و بالابر', 'Camas y grúas', 'Lits et lève-personnes', 'מיטות ומנופים', 'Letti e sollevatori', 'Betten & Lifter', 'Camas e elevadores', 'الأسرّة والرافعات'),
  'Rehab': row('توانبخشی', 'Rehabilitación', 'Rééducation', 'שיקום', 'Riabilitazione', 'Reha', 'Reabilitação', 'إعادة التأهيل'),
  'Defib': row('دفیبریلاتور', 'Desfibriladores', 'Défibrillateurs', 'דפיברילטורים', 'Defibrillatori', 'Defibrillatoren', 'Desfibriladores', 'أجهزة إزالة الرجفان'),
  'Test Equipment': row('تجهیزات تست', 'Equipos de prueba', 'Équipements de test', 'ציוד בדיקה', 'Strumenti di test', 'Prüfgeräte', 'Equipamentos de teste', 'معدات الاختبار'),
  'Other': row('سایر', 'Otros', 'Autres', 'אחר', 'Altro', 'Sonstiges', 'Outros', 'أخرى'),
  // Doc types
  'Service': row('سرویس', 'Servicio', 'Entretien', 'שירות', 'Assistenza', 'Wartung', 'Serviço', 'الخدمة'),
  'Operator': row('اپراتور', 'Operador', 'Opérateur', 'מפעיל', 'Operatore', 'Bediener', 'Operador', 'المشغل'),
  'Schematics': row('نقشه‌های مدار', 'Esquemas', 'Schémas', 'שרטוטים', 'Schemi', 'Schaltpläne', 'Esquemas', 'المخططات'),
  'PM / Calibration': row('نگهداری پیشگیرانه / کالیبراسیون', 'MP / calibración', 'Maintenance préventive / étalonnage', 'תחזוקה מונעת / כיול', 'Manutenzione preventiva / taratura', 'Wartung / Kalibrierung', 'MP / calibração', 'الصيانة الوقائية / المعايرة'),
  'Parts': row('قطعات', 'Repuestos', 'Pièces', 'חלקים', 'Ricambi', 'Ersatzteile', 'Peças', 'قطع الغيار'),
  // Filter chrome
  'Room': row('بخش', 'Área', 'Service', 'מחלקה', 'Reparto', 'Bereich', 'Área', 'القسم'),
  'Type': row('نوع', 'Tipo', 'Catégorie', 'סוג', 'Tipo', 'Typ', 'Tipo', 'النوع'),
  'Brand': row('برند', 'Marca', 'Marque', 'מותג', 'Marca', 'Marke', 'Marca', 'العلامة التجارية'),
  'Model': row('مدل', 'Modelo', 'Modèle', 'דגם', 'Modello', 'Modell', 'Modelo', 'الطراز'),
  'Document type': row('نوع سند', 'Tipo de documento', 'Type de document', 'סוג מסמך', 'Tipo di documento', 'Dokumenttyp', 'Tipo de documento', 'نوع المستند'),
  'All rooms': row('همه بخش‌ها', 'Todas las áreas', 'Tous les services', 'כל המחלקות', 'Tutti i reparti', 'Alle Bereiche', 'Todas as áreas', 'كل الأقسام'),
  'Model number or name': row('شماره یا نام مدل', 'Número o nombre del modelo', 'Numéro ou nom du modèle', 'מספר או שם דגם', 'Numero o nome del modello', 'Modellnummer oder -name', 'Número ou nome do modelo', 'رقم الطراز أو اسمه'),
  'Show all {n} brands': row('نمایش همه {n} برند', 'Mostrar las {n} marcas', 'Afficher les {n} marques', 'הצגת כל {n} המותגים', 'Mostra tutte le {n} marche', 'Alle {n} Marken anzeigen', 'Mostrar as {n} marcas', 'عرض كل العلامات ({n})'),
  'Show fewer': row('نمایش کمتر', 'Mostrar menos', 'Afficher moins', 'הצג פחות', 'Mostra meno', 'Weniger anzeigen', 'Mostrar menos', 'عرض أقل'),
  'Filter brands': row('فیلتر برندها', 'Filtrar marcas', 'Filtrer les marques', 'סינון מותגים', 'Filtra marche', 'Marken filtern', 'Filtrar marcas', 'تصفية العلامات'),
  'Pick a room to see equipment types.': row('برای دیدن انواع تجهیزات یک بخش را انتخاب کنید.', 'Elija un área para ver los tipos de equipo.', 'Choisissez un service pour voir les types d’équipement.', 'בחרו מחלקה כדי לראות סוגי ציוד.', 'Scegli un reparto per vedere i tipi di apparecchiatura.', 'Wählen Sie einen Bereich, um Gerätetypen zu sehen.', 'Escolha uma área para ver os tipos de equipamento.', 'اختر قسمًا لعرض أنواع المعدات.'),
  'Filters': row('فیلترها', 'Filtros', 'Filtres', 'מסננים', 'Filtri', 'Filter', 'Filtros', 'عوامل التصفية'),
};
