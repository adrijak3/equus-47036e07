import React, { useState } from 'react';
import { MessageCircle, X, MapPin, Phone, MessageSquare } from 'lucide-react';
import { Button } from './ui/button';

const FAQ_DATA = [
  { q: "Kainos ir pamokos", a: "Kainas rasite 'Kainos' skiltyje. Siūlome individualias ir grupines treniruotes." },
  { q: "Kaip atšaukti treniruotę?", a: "Savo treniruotę galite atšaukti Grafike pasirinkę treniruotę ir paspaudę „Atšaukti“. Jei liko mažiau nei 3 valandos, susisiekite su mumis." },
  { q: "Noriu užsiregistruoti šiandien", a: "Vieša registracija likus mažiau nei 3 valandoms iki treniruotės uždaroma. Jei norite užsiregistruoti vėliau, susisiekite su Equus." },
  { q: "Koks amžius leidžiamas?", a: "Nuo 3 metų – 'Mažylio svajonė'. Nuo 10 metų – sportinės treniruotės." },
];

export function EquusHelpWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{type: 'bot' | 'user', text: string}[]>([
    { type: 'bot', text: 'Sveiki! Kaip galiu padėti?' }
  ]);

  const handleFAQClick = (faq: typeof FAQ_DATA[0]) => {
    setMessages(prev => [...prev, { type: 'user', text: faq.q }, { type: 'bot', text: faq.a }]);
  };

  const handleFallback = () => {
    setMessages(prev => [...prev, 
      { type: 'user', text: 'Kita informacija' }, 
      { type: 'bot', text: 'Į šį klausimą tiksliai atsakyti negaliu. Susisiekite su Equus.' }
    ]);
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="fixed bottom-6 right-6 p-4 bg-amber-700 text-white rounded-full shadow-lg hover:bg-amber-800 transition-all z-50">
        <MessageCircle size={28} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 flex flex-col overflow-hidden">
      <div className="bg-amber-700 text-white p-4 flex justify-between items-center">
        <span className="font-semibold flex items-center gap-2">🐴 Equus pagalba</span>
        <button onClick={() => setIsOpen(false)}><X size={20} /></button>
      </div>
      
      <div className="p-4 h-80 overflow-y-auto flex flex-col gap-3 bg-gray-50">
        {messages.map((msg, idx) => (
          <div key={idx} className={`p-3 rounded-lg max-w-[85%] text-sm ${msg.type === 'bot' ? 'bg-white border border-gray-200 self-start' : 'bg-amber-100 text-amber-900 self-end'}`}>
            {msg.text}
          </div>
        ))}
      </div>

      <div className="p-3 bg-white border-t border-gray-200 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {FAQ_DATA.map((faq, idx) => (
            <button key={idx} onClick={() => handleFAQClick(faq)} className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full text-left transition-colors">
              {faq.q}
            </button>
          ))}
          <button onClick={handleFallback} className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full transition-colors">Kita...</button>
        </div>
        
        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
          <a href="https://maps.google.com/?q=Pikeliškės+g+7+Daučionys+Vilniaus+raj." target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center gap-1 text-xs py-2 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100">
            <MapPin size={14}/> Kaip atvykti
          </a>
          <a href="https://wa.me/37062876090" target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center gap-1 text-xs py-2 bg-green-50 text-green-700 rounded-md hover:bg-green-100">
            <MessageSquare size={14}/> WhatsApp
          </a>
          <a href="tel:+37062876090" className="flex-1 flex items-center justify-center gap-1 text-xs py-2 bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100">
            <Phone size={14}/> Skambinti
          </a>
        </div>
      </div>
    </div>
  );
}
