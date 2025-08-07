import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Globe, MessageCircle, CheckCircle, AlertCircle } from 'lucide-react'
import { healthAPI } from '../utils/api'

const HomePage = () => {
  const [healthStatus, setHealthStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkHealth()
  }, [])

  const checkHealth = async () => {
    try {
      const health = await healthAPI.checkHealth()
      setHealthStatus(health)
    } catch (error) {
      console.error('Health check failed:', error)
      setHealthStatus({ status: 'unhealthy', error: error.message })
    } finally {
      setLoading(false)
    }
  }

  const features = [
    {
      icon: Globe,
      title: 'Website Scraping',
      description: 'Scrape and extract content from any website. The content is automatically processed, chunked, and stored in your knowledge base.',
      link: '/scraping',
      buttonText: 'Start Scraping'
    },
    {
      icon: MessageCircle,
      title: 'AI Chat',
      description: 'Ask questions about the scraped content. Our AI chatbot uses RAG (Retrieval-Augmented Generation) to provide accurate answers.',
      link: '/chat',
      buttonText: 'Start Chatting'
    }
  ]

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Welcome to Oralia AI Chatbot
        </h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
          Scrape websites and chat with an AI that understands your content. 
          Powered by AWS Bedrock and advanced RAG technology.
        </p>
      </div>

      {/* Health Status */}
      <div className="mb-12">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            System Status
            {loading ? (
              <div className="ml-2 w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <div className={`ml-2 w-3 h-3 rounded-full ${
                healthStatus?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
              }`}></div>
            )}
          </h2>
          
          {!loading && healthStatus && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Overall Status:</span>
                <span className={`font-medium ${
                  healthStatus.status === 'healthy' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {healthStatus.status.charAt(0).toUpperCase() + healthStatus.status.slice(1)}
                </span>
              </div>
              
              {healthStatus.services && (
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">Services:</div>
                  {Object.entries(healthStatus.services).map(([service, status]) => (
                    <div key={service} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 capitalize">{service}:</span>
                      <div className="flex items-center">
                        {status ? (
                          <CheckCircle size={16} className="text-green-500 mr-1" />
                        ) : (
                          <AlertCircle size={16} className="text-red-500 mr-1" />
                        )}
                        <span className={status ? 'text-green-600' : 'text-red-600'}>
                          {status ? 'Healthy' : 'Unhealthy'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-2 gap-8 mb-12">
        {features.map((feature, index) => {
          const Icon = feature.icon
          return (
            <div key={index} className="card">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center mr-4">
                  <Icon size={24} className="text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900">{feature.title}</h3>
              </div>
              <p className="text-gray-600 mb-6 leading-relaxed">
                {feature.description}
              </p>
              <Link
                to={feature.link}
                className="btn-primary inline-block"
              >
                {feature.buttonText}
              </Link>
            </div>
          )
        })}
      </div>

      {/* Quick Start Guide */}
      <div className="card">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">Quick Start Guide</h2>
        <div className="space-y-4">
          <div className="flex items-start">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mr-4 mt-1">
              1
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Scrape a Website</h3>
              <p className="text-gray-600">Go to the scraping page and enter a URL to extract and process content.</p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mr-4 mt-1">
              2
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Wait for Processing</h3>
              <p className="text-gray-600">The system will automatically chunk the content and store it in your knowledge base.</p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mr-4 mt-1">
              3
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Start Chatting</h3>
              <p className="text-gray-600">Ask questions about the scraped content and get AI-powered answers.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomePage