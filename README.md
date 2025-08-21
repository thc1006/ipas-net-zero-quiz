# iPAS 淨零碳備考神器 🎯
淨零碳備考神器 | iPAS 淨零碳規劃管理師 考古題線上測驗

An interactive Vue 3 quiz application for Taiwan iPAS (Industrial Professional Assessment System) Net Zero Carbon Planning Manager certification preparation with 310 real exam questions.

## Features

- 📚 **310 Real Exam Questions** - Comprehensive question bank covering all certification topics
- 📱 **Responsive Design** - Mobile-first design that works perfectly on all devices
- 🎨 **Modern UI** - Beautiful gradient interface with smooth animations
- 📊 **Progress Tracking** - Visual progress bar with percentage completion
- 🔍 **Immediate Feedback** - Instant answer validation with explanations
- 🏆 **Results Dashboard** - Comprehensive score analysis with performance insights
- 🎯 **Chinese Interface** - Full Traditional Chinese support for Taiwan market
- ⚡ **Lightning Fast** - Built with Vue 3 and Vite for optimal performance
- 📈 **Score Analytics** - Detailed statistics with accuracy percentage

## Tech Stack

- **Vue 3** - Composition API with `<script setup>` syntax
- **Vite** - Next-generation frontend build tool
- **Custom CSS** - Gradient-based design with animations
- **JavaScript ES6+** - Modern JavaScript features

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Build for Production**
   ```bash
   npm run build
   ```

4. **Preview Production Build**
   ```bash
   npm run preview
   ```

## Project Structure

```
ipas-net-zero-quiz/
├── src/
│   ├── components/
│   │   ├── QuizView.vue       # Main quiz component with logic
│   │   └── ResultsView.vue    # Results display component
│   ├── assets/
│   │   └── questionsData.js   # Quiz questions dataset (310 questions)
│   ├── App.vue                # Root application component
│   └── main.js                # Application entry point
├── index.html                 # HTML template with SEO optimization
├── package.json               # Dependencies and scripts
├── vite.config.js             # Vite build configuration
├── start.bat                  # Windows quick start script
└── README.md                  # This file
```

## Customization

### Quiz Topics

The application includes 310 questions covering two main examination subjects:

1. **考科一：淨零碳規劃管理基礎概論** (40 questions)
   - ISO standards and frameworks
   - GRI and SASB reporting
   - Climate policies and strategies

2. **考科二：淨零碳盤查範圍與程序概要** (270 questions)
   - Carbon inventory methodologies
   - Emission categories and calculations
   - Industry-specific considerations

### Adding Questions
Questions are stored in `src/assets/questionsData.js` as a JavaScript module with the following structure:

```javascript
export default [
  {
    "id": "unique-id",
    "subject": "考科名稱",
    "question": "問題內容",
    "options": {
      "A": "選項A",
      "B": "選項B",
      "C": "選項C",
      "D": "選項D"
    },
    "answer": "B",
    "explanation": "解釋說明"
  }
]
```

## Browser Support

- Chrome (latest)
- Firefox (latest) 
- Safari (latest)
- Edge (latest)

## Windows Quick Start

```batch
# Double-click start.bat or run:
start.bat
```

## Development Notes

- Vue 3 Composition API for reactive state management
- Custom gradient CSS design with animations
- Vite for fast development and optimized builds
- Traditional Chinese interface optimized for Taiwan users

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

## License

This project is for educational purposes. All quiz content is based on publicly available iPAS certification materials.

---

**Good luck with your iPAS Net Zero Carbon Planning Manager certification! 加油！** 🌱
